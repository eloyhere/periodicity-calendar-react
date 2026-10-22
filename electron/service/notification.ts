import { BrowserWindow, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import { createOverlayWindow } from "../overlay/window";
import { createNotificationPlatform } from "./notification-platform";
import type {
    NotificationPlatformService,
    PlatformNotificationHandle,
} from "./notification-platform/types";
import type {
    NotificationPlatformInfo,
    SystemNotificationEvent,
    SystemNotificationHistoryItem,
    SystemNotificationOptions,
    SystemNotificationResult,
    SystemNotificationTimeout,
    SystemNotificationUrgency,
} from "./types";

const MAX_TITLE: number = 120;
const MAX_BODY: number = 600;
const MAX_SUBTITLE: number = 120;
const MAX_ACTIVE: number = 10;
const MAX_HISTORY: number = 50;

const URGENCIES: readonly SystemNotificationUrgency[] = ["normal", "critical", "low"];
const TIMEOUTS: readonly SystemNotificationTimeout[] = ["default", "never"];

export interface NotificationProcessHooks {
    getMainWindow: () => BrowserWindow | null;
    focusMainWindow: () => void;
}

/**
 * Trims and limits a string received over IPC.
 * @param value Untrusted value.
 * @param limit Maximum number of characters.
 * @return Trimmed string, or an empty string for non-strings.
 */
function cleanText(value: unknown, limit: number): string {
    if (typeof value !== "string") {
        return "";
    }
    return value.trim().slice(0, limit);
}

/**
 * Normalizes a Linux notification urgency.
 * @param value Untrusted urgency value.
 * @return A supported urgency, defaulting to normal.
 */
function normalizeUrgency(value: unknown): SystemNotificationUrgency {
    return URGENCIES.includes(value as SystemNotificationUrgency)
        ? (value as SystemNotificationUrgency)
        : "normal";
}

/**
 * Normalizes a notification timeout mode.
 * @param value Untrusted timeout value.
 * @return A supported timeout, defaulting to default.
 */
function normalizeTimeout(value: unknown): SystemNotificationTimeout {
    return TIMEOUTS.includes(value as SystemNotificationTimeout)
        ? (value as SystemNotificationTimeout)
        : "default";
}

/**
 * Converts a thrown value into a message.
 * @param error Value thrown while showing a notification.
 * @return Human-readable failure text.
 */
function describeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message || error.name;
    }
    return String(error);
}

/**
 * Owns the dedicated Notification process, its independent center window, and
 * the platform-specific notification backend. Native creation is delegated to
 * a Windows 10, Windows 11, or macOS service because Electron exposes the
 * Notification API only in the main process. Clicking a notification restores
 * the main window.
 */
export class NotificationProcess {
    private readonly hooks: NotificationProcessHooks;
    private readonly platform: NotificationPlatformService;
    private readonly active: Map<string, PlatformNotificationHandle> = new Map<string, PlatformNotificationHandle>();
    private win: BrowserWindow | null = null;
    private ready: boolean = false;
    private pendingOpen: boolean = false;
    private history: SystemNotificationHistoryItem[] = [];

    /**
     * Creates the notification service.
     * @param hooks Accessors used for event routing and click-to-focus.
     */
    public constructor(hooks: NotificationProcessHooks) {
        this.hooks = hooks;
        this.platform = createNotificationPlatform();
    }

    /**
     * Registers the IPC surface used by the application renderer and the
     * independent notification-center renderer.
     */
    public register(): void {
        ipcMain.handle("notification:show", (_event, options: SystemNotificationOptions) => {
            return this.show(options);
        });
        ipcMain.handle("notification:is-supported", () => {
            return this.platform.getInfo().supported;
        });
        ipcMain.handle("notification:platform-info", async () => {
            await this.platform.prepare();
            return this.platform.getInfo();
        });
        ipcMain.handle("notification:open-settings", () => {
            if (process.platform === "win32") {
                return shell.openExternal("ms-settings:notifications");
            }
            if (process.platform === "darwin") {
                return shell.openExternal("x-apple.systempreferences:com.apple.preference.notifications");
            }
            return Promise.resolve();
        });
        ipcMain.on("notification:close", (_event, id: unknown) => {
            if (typeof id === "string") {
                this.close(id);
            }
        });
        ipcMain.on("notification:open-center", () => {
            this.openCenter();
        });
        ipcMain.on("notification:center-ready", (event) => {
            if (this.win && event.sender === this.win.webContents) {
                this.handleCenterReady();
            }
        });
        ipcMain.on("notification:clear-history", (event) => {
            if (this.win && event.sender === this.win.webContents) {
                this.clearHistory();
            }
        });
    }

    /**
     * Opens the independent notification-center window.
     */
    public openCenter(): void {
        this.pendingOpen = true;
        try {
            this.ensureWindow();
        } catch {
            return;
        }
        if (this.win && this.ready) {
            this.pendingOpen = false;
            this.showCenterWindow();
        }
    }

    /**
     * Destroys the notification-center window while keeping the history.
     */
    public destroy(): void {
        this.pendingOpen = false;
        if (this.win && !this.win.isDestroyed()) {
            this.win.destroy();
        }
        this.win = null;
        this.ready = false;
    }

    /**
     * Creates and shows one native notification.
     * @param options Title, body, presentation flags, and focus policy.
     * @return Identifier plus whether the OS accepted the notification.
     */
    public async show(options: SystemNotificationOptions): Promise<SystemNotificationResult> {
        const id: string = randomUUID();
        const title: string = cleanText(options?.title, MAX_TITLE);
        if (title.length === 0) {
            throw new Error("系统通知标题不能为空。");
        }
        const body: string = cleanText(options?.body, MAX_BODY);
        const info: NotificationPlatformInfo = this.platform.getInfo();
        if (!info.supported) {
            return this.complete({
                id,
                supported: false,
                shown: false,
                reason: "当前系统不支持桌面通知。",
            }, title, body);
        }
        if (options?.whenUnfocused === true && BrowserWindow.getFocusedWindow() !== null) {
            return this.complete({
                id,
                supported: true,
                shown: false,
                reason: "应用处于前台，已跳过系统通知。",
            }, title, body);
        }

        const subtitle: string = cleanText(options?.subtitle, MAX_SUBTITLE);
        const sound: string = cleanText(options?.sound, 200);
        if (this.active.size >= MAX_ACTIVE) {
            const oldest: string | undefined = this.active.keys().next().value;
            if (oldest) {
                this.close(oldest);
            }
        }

        try {
            await this.platform.prepare();
            const handle: PlatformNotificationHandle = this.platform.show({
                id,
                title,
                body: body.length > 0 ? body : (void 0),
                subtitle: subtitle.length > 0 ? subtitle : (void 0),
                silent: options?.silent === true,
                urgency: normalizeUrgency(options?.urgency),
                timeoutType: normalizeTimeout(options?.timeoutType),
                sound: sound.length > 0 ? sound : (void 0),
            }, {
                onShow: (): void => {
                    this.emit({
                        id,
                        type: "show",
                    });
                },
                onClick: (): void => {
                    this.hooks.focusMainWindow();
                    this.emit({
                        id,
                        type: "click",
                    });
                },
                onClose: (): void => {
                    if (!this.active.has(id)) {
                        return;
                    }
                    this.active.delete(id);
                    this.emit({
                        id,
                        type: "close",
                    });
                },
                onFailed: (error: string): void => {
                    this.active.delete(id);
                    this.emit({
                        id,
                        type: "failed",
                        error,
                    });
                },
                onAction: (index: number): void => {
                    this.emit({
                        id,
                        type: "action",
                        actionIndex: index,
                    });
                },
            });
            this.active.set(id, handle);
        } catch (error: unknown) {
            this.active.delete(id);
            return this.complete({
                id,
                supported: true,
                shown: false,
                reason: describeError(error),
            }, title, body);
        }

        return this.complete({
            id,
            supported: true,
            shown: true,
        }, title, body);
    }

    /**
     * Dismisses one notification by identifier.
     * @param id Notification identifier returned by `show`.
     */
    public close(id: string): void {
        const handle: PlatformNotificationHandle | undefined = this.active.get(id);
        if (!handle) {
            return;
        }
        this.active.delete(id);
        handle.close();
        this.emit({
            id,
            type: "close",
        });
    }

    /**
     * Clears the notification center history.
     */
    public clearHistory(): void {
        this.history = [];
        this.pushHistory();
    }

    /**
     * Records one result in the center history and optionally starts the
     * notification-center renderer process.
     * @param result Native result returned to the caller.
     * @param title Notification title.
     * @param body Notification body.
     * @return The same result, after history bookkeeping.
     */
    private complete(
        result: SystemNotificationResult,
        title: string,
        body: string,
    ): SystemNotificationResult {
        const item: SystemNotificationHistoryItem = {
            ...result,
            title,
            body: body.length > 0 ? body : (void 0),
            at: new Date().toISOString(),
        };
        this.history = [item, ...this.history].slice(0, MAX_HISTORY);
        if (result.shown) {
            try {
                this.ensureWindow();
            } catch {
                // History is still kept when the center process cannot start.
            }
        }
        this.pushHistory();
        return result;
    }

    /**
     * Creates the independent notification-center window when it is absent.
     */
    private ensureWindow(): void {
        if (this.win && !this.win.isDestroyed()) {
            return;
        }
        const win: BrowserWindow = createOverlayWindow({
            page: "notification",
            width: 460,
            height: 560,
            title: "通知中心",
            focusable: true,
            resizable: true,
            movable: true,
            transparent: false,
            backgroundColor: "#0d131a",
            hasShadow: true,
            skipTaskbar: false,
            minWidth: 360,
            minHeight: 360,
            center: true,
            thickFrame: true,
        });
        this.win = win;
        this.ready = false;
        win.on("closed", () => {
            if (this.win === win) {
                this.win = null;
                this.ready = false;
            }
        });
        win.webContents.on("did-fail-load", (_event, errorCode: number, _description: string, _url: string, isMainFrame: boolean) => {
            if (!isMainFrame || errorCode === -3) {
                return;
            }
            this.destroy();
        });
        win.webContents.on("render-process-gone", () => {
            if (this.win === win) {
                this.win = null;
                this.ready = false;
            }
            if (!win.isDestroyed()) {
                win.destroy();
            }
        });
    }

    /**
     * Handles the notification-center renderer becoming ready.
     */
    private handleCenterReady(): void {
        this.ready = true;
        this.pushHistory();
        if (this.pendingOpen) {
            this.pendingOpen = false;
            this.showCenterWindow();
        }
    }

    /**
     * Shows and focuses the notification-center window.
     */
    private showCenterWindow(): void {
        if (!this.win || this.win.isDestroyed() || !this.ready) {
            return;
        }
        this.pushHistory();
        this.win.show();
        this.win.focus();
        this.win.moveTop();
    }

    /**
     * Sends the current notification history to the center renderer.
     */
    private pushHistory(): void {
        if (!this.win || this.win.isDestroyed() || !this.ready) {
            return;
        }
        try {
            this.win.webContents.send("notification:history", this.history);
        } catch {
            // The center renderer can disappear while the window is closing.
        }
    }

    /**
     * Sends one native notification event to the application renderer.
     * @param event Notification identifier, type, and optional action details.
     */
    private emit(event: SystemNotificationEvent): void {
        const window: BrowserWindow | null = this.hooks.getMainWindow();
        if (!window || window.isDestroyed()) {
            return;
        }
        const contents: Electron.WebContents = window.webContents;
        if (contents.isDestroyed()) {
            return;
        }
        if (contents.isLoadingMainFrame()) {
            contents.once("did-finish-load", () => {
                if (!window.isDestroyed() && !contents.isDestroyed()) {
                    try {
                        contents.send("notification:event", event);
                    } catch {
                        // The main renderer can disappear while the page is reloading.
                    }
                }
            });
            return;
        }
        try {
            contents.send("notification:event", event);
        } catch {
            // The main renderer can disappear while a notification is open.
        }
    }
}
