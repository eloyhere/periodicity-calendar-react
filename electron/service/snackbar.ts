import { BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import {
    createOverlayWindow,
    placeOverlay,
    trackParentWindow,
    type OverlayAnchor,
} from "../overlay/window";
import type {
    SnackbarAnchor,
    SnackbarCloseReason,
    SnackbarOptions,
    SnackbarResult,
    SnackbarState,
    SnackbarTone,
} from "./types";

const SURFACE_WIDTH: number = 608;
const SURFACE_MAX_HEIGHT: number = 360;
const SURFACE_MIN_HEIGHT: number = 64;
const VERTICAL_CHROME: number = 40;
const DEFAULT_DURATION: number = 5000;
const MAX_DURATION: number = 60000;

const TONES: readonly SnackbarTone[] = ["neutral", "success", "warning", "danger"];
const ANCHORS: readonly SnackbarAnchor[] = ["bottom-left", "bottom-center", "bottom-right"];
const CLOSE_REASONS: readonly SnackbarCloseReason[] = [
    "action",
    "dismiss",
    "timeout",
    "replaced",
    "hidden",
    "window-closed",
    "failed",
];

interface PendingSnackbar {
    state: SnackbarState;
    resolve: (result: SnackbarResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Normalizes a tone received over IPC.
 * @param value Untrusted tone value.
 * @return A supported tone, defaulting to neutral.
 */
function normalizeTone(value: unknown): SnackbarTone {
    return TONES.includes(value as SnackbarTone) ? (value as SnackbarTone) : "neutral";
}

/**
 * Normalizes an anchor received over IPC.
 * @param value Untrusted anchor value.
 * @return A supported anchor, defaulting to bottom-center.
 */
function normalizeAnchor(value: unknown): SnackbarAnchor {
    return ANCHORS.includes(value as SnackbarAnchor) ? (value as SnackbarAnchor) : "bottom-center";
}

/**
 * Normalizes a close reason received from the overlay renderer.
 * @param value Untrusted reason value.
 * @return A supported close reason, defaulting to dismiss.
 */
function normalizeReason(value: unknown): SnackbarCloseReason {
    return CLOSE_REASONS.includes(value as SnackbarCloseReason)
        ? (value as SnackbarCloseReason)
        : "dismiss";
}

/**
 * Normalizes a snackbar duration.
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
 * Maps a snackbar anchor to an overlay placement anchor.
 * @param anchor Snackbar anchor.
 * @return Placement anchor used by the window helper.
 */
function placementAnchor(anchor: SnackbarAnchor): OverlayAnchor {
    if (anchor === "bottom-left") {
        return "bottom-left";
    }
    if (anchor === "bottom-right") {
        return "bottom-right";
    }
    return "bottom-center";
}

/**
 * Owns the dedicated Snackbar renderer process and its window.
 * Snackbar requests are serialized: a new message replaces the visible one and
 * resolves the previous caller with the `replaced` reason.
 */
export class SnackbarProcess {
    private parent: BrowserWindow | null = null;
    private win: BrowserWindow | null = null;
    private ready: boolean = false;
    private pending: PendingSnackbar | null = null;
    private state: SnackbarState | null = null;
    private contentHeight: number = 48;
    private detachTracking: (() => void) | null = null;
    private parentCloseHandler: (() => void) | null = null;

    /**
     * Registers the IPC surface used by both the application renderer and the
     * snackbar renderer. Must be called exactly once.
     */
    public register(): void {
        ipcMain.handle("snackbar:show", (_event, options: SnackbarOptions) => {
            return this.show(options);
        });
        ipcMain.on("snackbar:hide", () => {
            this.finish("hidden");
        });
        ipcMain.on("snackbar:ready", (event) => {
            if (this.win && event.sender === this.win.webContents) {
                this.handleReady();
            }
        });
        ipcMain.on("snackbar:resize", (event, height: unknown) => {
            if (this.win && event.sender === this.win.webContents) {
                this.handleResize(height);
            }
        });
        ipcMain.on("snackbar:closed", (event, reason: unknown) => {
            if (this.win && event.sender === this.win.webContents) {
                this.finish(normalizeReason(reason));
            }
        });
    }

    /**
     * Binds the snackbar overlay to the current main window.
     * @param parent Main window that owns the overlay.
     */
    public attach(parent: BrowserWindow): void {
        this.detach();
        this.parent = parent;
        const handleClosed: () => void = () => {
            if (this.parent === parent) {
                this.parent = null;
                this.parentCloseHandler = null;
                this.rejectPending(new Error("主窗口已关闭，Snackbar 已取消。"));
                this.destroyWindow();
            }
        };
        this.parentCloseHandler = handleClosed;
        parent.once("closed", handleClosed);
    }

    /**
     * Releases the current parent window and closes the snackbar overlay.
     */
    public detach(): void {
        if (this.parent && !this.parent.isDestroyed() && this.parentCloseHandler) {
            this.parent.removeListener("closed", this.parentCloseHandler);
        }
        this.parent = null;
        this.parentCloseHandler = null;
        this.rejectPending(new Error("Snackbar 父窗口已更换。"));
        this.state = null;
        this.contentHeight = 0;
        this.destroyWindow();
    }

    /**
     * Shows one snackbar and resolves when it closes.
     * @param options Message, tone, action, duration, and anchor.
     * @return Close reason and identifier of the settled snackbar.
     */
    public show(options: SnackbarOptions): Promise<SnackbarResult> {
        return new Promise<SnackbarResult>((resolve, reject) => {
            if (!this.parent || this.parent.isDestroyed()) {
                reject(new Error("Snackbar 主窗口不可用。"));
                return;
            }
            const message: string = typeof options?.message === "string" ? options.message.trim() : "";
            if (message.length === 0) {
                reject(new Error("Snackbar 消息不能为空。"));
                return;
            }
            this.settle("replaced");
            const state: SnackbarState = {
                id: randomUUID(),
                message: message.slice(0, 600),
                tone: normalizeTone(options.tone),
                actionLabel: typeof options.actionLabel === "string" && options.actionLabel.trim().length > 0
                    ? options.actionLabel.trim().slice(0, 24)
                    : (void 0),
                duration: normalizeDuration(options.duration),
                anchor: normalizeAnchor(options.anchor),
            };
            const timer: ReturnType<typeof setTimeout> | null = state.duration > 0
                ? setTimeout(() => {
                    if (this.pending?.state.id === state.id) {
                        this.finish("timeout");
                    }
                }, state.duration + 2500)
                : null;
            this.state = state;
            this.pending = {
                state,
                resolve,
                reject,
                timer,
            };
            try {
                this.ensureWindow();
            } catch (error: unknown) {
                this.state = null;
                this.rejectPending(error instanceof Error ? error : new Error("Snackbar 窗口创建失败。"));
                return;
            }
            if (!this.win) {
                this.state = null;
                this.rejectPending(new Error("Snackbar 窗口创建失败。"));
                return;
            }
            if (this.ready) {
                this.pushState();
                this.position();
            }
        });
    }

    /**
     * Resolves the pending snackbar without an error.
     * @param reason Reason reported to the original caller.
     */
    private settle(reason: SnackbarCloseReason): void {
        const pending: PendingSnackbar | null = this.pending;
        if (!pending) {
            return;
        }
        this.pending = null;
        if (pending.timer) {
            clearTimeout(pending.timer);
        }
        pending.resolve({
            id: pending.state.id,
            reason,
        });
    }

    /**
     * Rejects the pending snackbar because its window or parent disappeared.
     * @param error Failure surfaced to the original caller.
     */
    private rejectPending(error: Error): void {
        const pending: PendingSnackbar | null = this.pending;
        if (!pending) {
            return;
        }
        this.pending = null;
        this.state = null;
        if (pending.timer) {
            clearTimeout(pending.timer);
        }
        pending.reject(error);
    }

    /**
     * Closes the current snackbar and notifies its renderer.
     * @param reason Reason reported to the original caller.
     */
    private finish(reason: SnackbarCloseReason): void {
        this.settle(reason);
        this.state = null;
        this.pushState();
        this.hideWindow();
        if (reason === "window-closed") {
            this.cleanupWindow();
        }
    }

    /**
     * Handles the snackbar renderer becoming ready for updates.
     */
    private handleReady(): void {
        this.ready = true;
        if (!this.state) {
            return;
        }
        this.pushState();
        this.position();
    }

    /**
     * Applies a content height reported by the snackbar renderer.
     * @param height Measured snackbar surface height in pixels.
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
        if (this.state) {
            this.showWindow();
        }
    }

    /**
     * Creates the snackbar window when it is not alive.
     */
    private ensureWindow(): void {
        if (this.win && !this.win.isDestroyed()) {
            return;
        }
        if (!this.parent || this.parent.isDestroyed()) {
            return;
        }
        const win: BrowserWindow = createOverlayWindow({
            page: "snackbar",
            width: SURFACE_WIDTH,
            height: SURFACE_MIN_HEIGHT,
            parent: this.parent,
            title: "Snackbar",
            focusable: false,
            transparent: true,
        });
        this.win = win;
        this.ready = false;
        this.contentHeight = 48;
        this.detachTracking = trackParentWindow(win, this.parent, () => {
            this.position();
        });
        win.on("closed", () => {
            if (this.win !== win) {
                return;
            }
            this.cleanupWindow();
            this.finish("window-closed");
        });
        win.webContents.on("did-fail-load", (_event, errorCode: number, errorDescription: string, _url: string, isMainFrame: boolean) => {
            if (this.win !== win || !isMainFrame || errorCode === -3) {
                return;
            }
            this.rejectPending(new Error(`Snackbar 窗口加载失败：${errorDescription}`));
            this.destroyWindow();
        });
        win.webContents.on("render-process-gone", (_event, details: Electron.RenderProcessGoneDetails) => {
            if (this.win !== win) {
                return;
            }
            this.rejectPending(new Error(`Snackbar 渲染进程退出：${details.reason}`));
            this.destroyWindow();
        });
    }

    /**
     * Sends the current snackbar state to the overlay renderer.
     */
    private pushState(): void {
        if (!this.win || this.win.isDestroyed() || !this.ready) {
            return;
        }
        this.win.webContents.send("snackbar:update", this.state);
    }

    /**
     * Applies the current anchor and measured height to the window.
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
            anchor: placementAnchor(this.state?.anchor ?? "bottom-center"),
            width: SURFACE_WIDTH,
            height,
        });
    }

    /**
     * Shows the snackbar window without taking keyboard focus.
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
     * Hides the snackbar window while keeping its renderer alive.
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
     * Destroys the snackbar window and releases parent tracking.
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
    }
}
