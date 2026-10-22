import { BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { createOverlayWindow, placeOverlay, trackParentWindow } from "../overlay/window";
import type {
    ToastDismissReason,
    ToastItem,
    ToastOptions,
    ToastResult,
    ToastTone,
} from "./types";

const SURFACE_WIDTH: number = 408;
const SURFACE_MAX_HEIGHT: number = 520;
const SURFACE_MIN_HEIGHT: number = 60;
const VERTICAL_CHROME: number = 40;
const DEFAULT_DURATION: number = 4000;
const MAX_DURATION: number = 60000;
const MAX_VISIBLE_ITEMS: number = 12;

const TONES: readonly ToastTone[] = ["neutral", "success", "warning", "danger"];
const DISMISS_REASONS: readonly ToastDismissReason[] = [
    "action",
    "dismiss",
    "timeout",
    "programmatic",
    "window-closed",
    "failed",
];

interface PendingToast {
    item: ToastItem;
    resolve: (result: ToastResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Normalizes a toast tone received over IPC.
 * @param value Untrusted tone value.
 * @return A supported tone, defaulting to neutral.
 */
function normalizeTone(value: unknown): ToastTone {
    return TONES.includes(value as ToastTone) ? (value as ToastTone) : "neutral";
}

/**
 * Normalizes a dismiss reason received from the toast renderer.
 * @param value Untrusted reason value.
 * @return A supported dismiss reason, defaulting to dismiss.
 */
function normalizeReason(value: unknown): ToastDismissReason {
    return DISMISS_REASONS.includes(value as ToastDismissReason)
        ? (value as ToastDismissReason)
        : "dismiss";
}

/**
 * Normalizes a toast duration.
 * @param value Untrusted duration in milliseconds.
 * @return A finite duration between zero and one minute.
 */
function normalizeDuration(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return DEFAULT_DURATION;
    }
    return Math.min(MAX_DURATION, Math.max(0, Math.round(value)));
}

/**
 * Owns the dedicated Toast renderer process and its window.
 * The main process keeps the authoritative list and pending results; the
 * renderer only draws the list and reports user or timer dismissals.
 */
export class ToastProcess {
    private parent: BrowserWindow | null = null;
    private win: BrowserWindow | null = null;
    private ready: boolean = false;
    private items: Map<string, ToastItem> = new Map<string, ToastItem>();
    private pending: Map<string, PendingToast> = new Map<string, PendingToast>();
    private contentHeight: number = 0;
    private detachTracking: (() => void) | null = null;
    private parentCloseHandler: (() => void) | null = null;

    /**
     * Registers the IPC surface used by both the application renderer and the
     * toast renderer. Must be called exactly once.
     */
    public register(): void {
        ipcMain.handle("toast:show", (_event, options: ToastOptions) => {
            return this.show(options);
        });
        ipcMain.on("toast:dismiss", (_event, id: unknown) => {
            if (typeof id === "string") {
                this.finish(id, "programmatic");
            }
        });
        ipcMain.on("toast:ready", (event) => {
            if (this.win && event.sender === this.win.webContents) {
                this.handleReady();
            }
        });
        ipcMain.on("toast:resize", (event, height: unknown) => {
            if (this.win && event.sender === this.win.webContents) {
                this.handleResize(height);
            }
        });
        ipcMain.on("toast:closed", (event, id: unknown, reason: unknown) => {
            if (this.win && event.sender === this.win.webContents && typeof id === "string") {
                this.finish(id, normalizeReason(reason));
            }
        });
    }

    /**
     * Binds the toast overlay to the current main window.
     * @param parent Main window that owns the overlay.
     */
    public attach(parent: BrowserWindow): void {
        this.detach();
        this.parent = parent;
        const handleClosed: () => void = () => {
            if (this.parent === parent) {
                this.parent = null;
                this.parentCloseHandler = null;
                this.failAll(new Error("主窗口已关闭，Toast 已取消。"));
                this.destroyWindow();
            }
        };
        this.parentCloseHandler = handleClosed;
        parent.once("closed", handleClosed);
    }

    /**
     * Releases the current parent window and closes the toast overlay.
     */
    public detach(): void {
        if (this.parent && !this.parent.isDestroyed() && this.parentCloseHandler) {
            this.parent.removeListener("closed", this.parentCloseHandler);
        }
        this.parent = null;
        this.parentCloseHandler = null;
        this.failAll(new Error("Toast 父窗口已更换。"));
        this.contentHeight = 0;
        this.destroyWindow();
    }

    /**
     * Queues one toast and resolves when it is dismissed.
     * @param options Title, description, tone, duration, and optional action.
     * @return Dismiss reason and identifier of the settled toast.
     */
    public show(options: ToastOptions): Promise<ToastResult> {
        return new Promise<ToastResult>((resolve, reject) => {
            if (!this.parent || this.parent.isDestroyed()) {
                reject(new Error("Toast 主窗口不可用。"));
                return;
            }
            const title: string = typeof options?.title === "string" ? options.title.trim() : "";
            if (title.length === 0) {
                reject(new Error("Toast 标题不能为空。"));
                return;
            }
            if (this.pending.size >= MAX_VISIBLE_ITEMS) {
                reject(new Error("Toast 队列已满。"));
                return;
            }
            const item: ToastItem = {
                id: randomUUID(),
                title: title.slice(0, 120),
                description: typeof options.description === "string" && options.description.trim().length > 0
                    ? options.description.trim().slice(0, 400)
                    : (void 0),
                tone: normalizeTone(options.tone),
                duration: normalizeDuration(options.duration),
                actionLabel: typeof options.actionLabel === "string" && options.actionLabel.trim().length > 0
                    ? options.actionLabel.trim().slice(0, 24)
                    : (void 0),
            };
            const timer: ReturnType<typeof setTimeout> | null = item.duration > 0
                ? setTimeout(() => {
                    this.finish(item.id, "timeout");
                }, item.duration + 3000)
                : null;
            this.items.set(item.id, item);
            this.pending.set(item.id, {
                item,
                resolve,
                reject,
                timer,
            });
            try {
                this.ensureWindow();
            } catch (error: unknown) {
                this.failAll(error instanceof Error ? error : new Error("Toast 窗口创建失败。"));
                return;
            }
            if (!this.win) {
                this.failAll(new Error("Toast 窗口创建失败。"));
                return;
            }
            if (this.ready) {
                this.pushItems();
                this.position();
            }
        });
    }

    /**
     * Dismisses one toast and resolves its original caller.
     * @param id Toast identifier.
     * @param reason Reason reported to the caller.
     */
    private finish(id: string, reason: ToastDismissReason): void {
        const pending: PendingToast | undefined = this.pending.get(id);
        if (!pending) {
            return;
        }
        this.pending.delete(id);
        this.items.delete(id);
        if (pending.timer) {
            clearTimeout(pending.timer);
        }
        pending.resolve({
            id,
            reason,
        });
        this.pushItems();
        if (this.items.size === 0) {
            this.hideWindow();
        }
    }

    /**
     * Rejects every queued toast because the overlay or its parent disappeared.
     * @param error Failure surfaced to each caller.
     */
    private failAll(error: Error): void {
        const pending: PendingToast[] = [...this.pending.values()];
        this.pending.clear();
        this.items.clear();
        for (const entry of pending) {
            if (entry.timer) {
                clearTimeout(entry.timer);
            }
            entry.reject(error);
        }
        this.contentHeight = 0;
        this.pushItems();
        this.hideWindow();
    }

    /**
     * Handles the toast renderer becoming ready for updates.
     */
    private handleReady(): void {
        this.ready = true;
        this.pushItems();
        if (this.items.size > 0) {
            this.position();
        }
    }

    /**
     * Applies a content height reported by the toast renderer.
     * @param height Measured toast region height in pixels.
     */
    private handleResize(height: unknown): void {
        if (typeof height !== "number" || !Number.isFinite(height)) {
            return;
        }
        this.contentHeight = Math.max(0, Math.min(SURFACE_MAX_HEIGHT, Math.round(height)));
        if (this.contentHeight <= 0) {
            this.hideWindow();
            return;
        }
        this.position();
        if (this.items.size > 0) {
            this.showWindow();
        }
    }

    /**
     * Creates the toast window when it is not alive.
     */
    private ensureWindow(): void {
        if (this.win && !this.win.isDestroyed()) {
            return;
        }
        if (!this.parent || this.parent.isDestroyed()) {
            return;
        }
        const win: BrowserWindow = createOverlayWindow({
            page: "toast",
            width: SURFACE_WIDTH,
            height: SURFACE_MIN_HEIGHT,
            parent: this.parent,
            title: "Toast",
            focusable: false,
            transparent: true,
        });
        this.win = win;
        this.ready = false;
        this.contentHeight = 0;
        this.detachTracking = trackParentWindow(win, this.parent, () => {
            this.position();
        });
        win.on("closed", () => {
            if (this.win !== win) {
                return;
            }
            this.cleanupWindow();
            this.failAll(new Error("Toast 窗口已关闭。"));
        });
        win.webContents.on("did-fail-load", (_event, errorCode: number, errorDescription: string, _url: string, isMainFrame: boolean) => {
            if (this.win !== win || !isMainFrame || errorCode === -3) {
                return;
            }
            this.failAll(new Error(`Toast 窗口加载失败：${errorDescription}`));
            this.destroyWindow();
        });
        win.webContents.on("render-process-gone", (_event, details: Electron.RenderProcessGoneDetails) => {
            if (this.win !== win) {
                return;
            }
            this.failAll(new Error(`Toast 渲染进程退出：${details.reason}`));
            this.destroyWindow();
        });
    }

    /**
     * Sends the authoritative toast list to the overlay renderer.
     */
    private pushItems(): void {
        if (!this.win || this.win.isDestroyed() || !this.ready) {
            return;
        }
        this.win.webContents.send("toast:update", [...this.items.values()]);
    }

    /**
     * Applies the measured stack height to the bottom-right window.
     */
    private position(): void {
        if (!this.win || !this.parent || this.win.isDestroyed() || this.parent.isDestroyed()) {
            return;
        }
        const height: number = Math.max(
            SURFACE_MIN_HEIGHT,
            Math.min(SURFACE_MAX_HEIGHT + VERTICAL_CHROME, this.contentHeight + VERTICAL_CHROME),
        );
        placeOverlay(this.win, this.parent, {
            anchor: "bottom-right",
            width: SURFACE_WIDTH,
            height,
        });
    }

    /**
     * Shows the toast window without taking keyboard focus.
     */
    private showWindow(): void {
        if (!this.win || this.win.isDestroyed()) {
            return;
        }
        if (!this.win.isVisible()) {
            this.win.showInactive();
        }
    }

    /**
     * Hides the toast window while keeping its renderer alive.
     */
    private hideWindow(): void {
        if (!this.win || this.win.isDestroyed()) {
            return;
        }
        if (this.win.isVisible()) {
            this.win.hide();
        }
    }

    /**
     * Destroys the toast window and releases parent tracking.
     */
    private destroyWindow(): void {
        if (this.win && !this.win.isDestroyed()) {
            this.win.destroy();
        }
        this.cleanupWindow();
    }

    /**
     * Clears window bookkeeping after the window is gone.
     */
    private cleanupWindow(): void {
        if (this.detachTracking) {
            this.detachTracking();
            this.detachTracking = null;
        }
        this.win = null;
        this.ready = false;
        this.contentHeight = 0;
    }
}
