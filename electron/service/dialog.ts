import { BrowserWindow, ipcMain, screen } from "electron";
import { createOverlayWindow, placeWithin } from "../overlay/window";
import type {
    DialogAction,
    DialogOptions,
    DialogResult,
    DialogSize,
    DialogTone,
} from "./types";

const SIZES: readonly DialogSize[] = ["sm", "md", "lg"];
const TONES: readonly DialogTone[] = ["neutral", "success", "warning", "danger"];
const ACTIONS: readonly DialogAction[] = ["confirm", "cancel", "dismiss"];
const READY_TIMEOUT_MS: number = 15000;
const WINDOW_WIDTH: number = 680;
const WINDOW_HEIGHT: number = 520;

interface ActiveDialog {
    request: DialogOptions;
    resolve: (result: DialogResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Normalizes a dialog size received over IPC.
 * @param value Untrusted size value.
 * @return A supported dialog size, defaulting to md.
 */
function normalizeSize(value: unknown): DialogSize {
    return SIZES.includes(value as DialogSize) ? (value as DialogSize) : "md";
}

/**
 * Normalizes a dialog tone received over IPC.
 * @param value Untrusted tone value.
 * @return A supported dialog tone, defaulting to neutral.
 */
function normalizeTone(value: unknown): DialogTone {
    return TONES.includes(value as DialogTone) ? (value as DialogTone) : "neutral";
}

/**
 * Normalizes a dialog action received from the overlay renderer.
 * @param value Untrusted action value.
 * @return A supported action, defaulting to cancel.
 */
function normalizeAction(value: unknown): DialogAction {
    return ACTIONS.includes(value as DialogAction) ? (value as DialogAction) : "cancel";
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
 * Validates and normalizes dialog options received over IPC.
 * @param options Untrusted dialog options.
 * @return A normalized request, or null when the title is missing.
 */
function normalizeOptions(options: DialogOptions): DialogOptions | null {
    const title: string = cleanText(options?.title, 120);
    if (title.length === 0) {
        return null;
    }
    const inputOption: DialogOptions["input"] = options?.input;
    const input: DialogOptions["input"] = inputOption && typeof inputOption.label === "string"
        ? {
            label: cleanText(inputOption.label, 80),
            placeholder: cleanText(inputOption.placeholder, 160) || (void 0),
            value: typeof inputOption.value === "string" ? inputOption.value.slice(0, 500) : (void 0),
            required: inputOption.required === true,
            maxLength: typeof inputOption.maxLength === "number" && Number.isFinite(inputOption.maxLength)
                ? Math.min(500, Math.max(1, Math.round(inputOption.maxLength)))
                : 200,
        }
        : (void 0);
    return {
        title,
        description: cleanText(options?.description, 600) || (void 0),
        message: cleanText(options?.message, 2000) || (void 0),
        eyebrow: cleanText(options?.eyebrow, 40) || (void 0),
        tone: normalizeTone(options?.tone),
        size: normalizeSize(options?.size),
        confirmLabel: cleanText(options?.confirmLabel, 24) || (void 0),
        cancelLabel: cleanText(options?.cancelLabel, 24) || (void 0),
        showCancel: options?.showCancel !== false,
        input: input && input.label.length > 0 ? input : (void 0),
    };
}

/**
 * Owns the dedicated Dialog renderer process and its modal window.
 * One dialog can be open at a time; the window is recreated for each request so
 * focus and form state never leak between dialogs.
 */
export class DialogProcess {
    private parent: BrowserWindow | null = null;
    private win: BrowserWindow | null = null;
    private active: ActiveDialog | null = null;
    private generation: number = 0;
    private parentCloseHandler: (() => void) | null = null;

    /**
     * Registers the IPC surface used by both the application renderer and the
     * dialog renderer. Must be called exactly once.
     */
    public register(): void {
        ipcMain.handle("dialog:open", (_event, options: DialogOptions) => {
            return this.open(options);
        });
        ipcMain.on("dialog:ready", (event) => {
            if (this.win && event.sender === this.win.webContents) {
                this.handleReady();
            }
        });
        ipcMain.on("dialog:resolve", (event, result: DialogResult) => {
            if (this.win && event.sender === this.win.webContents) {
                this.finish(result);
            }
        });
    }

    /**
     * Binds the dialog overlay to the current main window.
     * @param parent Main window that owns the overlay.
     */
    public attach(parent: BrowserWindow): void {
        this.detach();
        this.parent = parent;
        const handleClosed: () => void = () => {
            if (this.parent === parent) {
                this.parent = null;
                this.parentCloseHandler = null;
                this.rejectActive(new Error("主窗口已关闭，Dialog 已取消。"));
                this.destroyWindow();
            }
        };
        this.parentCloseHandler = handleClosed;
        parent.once("closed", handleClosed);
    }

    /**
     * Releases the current parent window and closes any open dialog.
     */
    public detach(): void {
        if (this.parent && !this.parent.isDestroyed() && this.parentCloseHandler) {
            this.parent.removeListener("closed", this.parentCloseHandler);
        }
        this.parent = null;
        this.parentCloseHandler = null;
        this.rejectActive(new Error("Dialog 父窗口已更换。"));
        this.destroyWindow();
    }

    /**
     * Opens one modal dialog and resolves when it closes.
     * @param options Title, copy, tone, size, actions, and optional input field.
     * @return The action chosen by the user and the input value when present.
     */
    public open(options: DialogOptions): Promise<DialogResult> {
        return new Promise<DialogResult>((resolve, reject) => {
            if (this.active) {
                reject(new Error("另一个对话框已打开，请先关闭它。"));
                return;
            }
            if (!this.parent || this.parent.isDestroyed()) {
                reject(new Error("Dialog 主窗口不可用。"));
                return;
            }
            const request: DialogOptions | null = normalizeOptions(options);
            if (!request) {
                reject(new Error("Dialog 标题不能为空。"));
                return;
            }
            this.generation += 1;
            const generation: number = this.generation;
            const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
                if (this.generation !== generation) {
                    return;
                }
                this.rejectActive(new Error("Dialog 窗口未在 15 秒内就绪。"));
                this.destroyWindow();
            }, READY_TIMEOUT_MS);
            this.active = {
                request,
                resolve,
                reject,
                timer,
            };
            try {
                this.ensureWindow();
            } catch (error: unknown) {
                if (this.active?.timer) {
                    clearTimeout(this.active.timer);
                }
                this.active = null;
                reject(error instanceof Error ? error : new Error("Dialog 窗口创建失败。"));
                return;
            }
            if (!this.win) {
                this.rejectActive(new Error("Dialog 窗口创建失败。"));
            }
        });
    }

    /**
     * Resolves the active dialog with the result chosen by the renderer.
     * @param result Action and optional input value.
     */
    private finish(result: DialogResult): void {
        const active: ActiveDialog | null = this.active;
        if (!active) {
            return;
        }
        this.active = null;
        if (active.timer) {
            clearTimeout(active.timer);
        }
        const action: DialogAction = normalizeAction(result?.action);
        const value: string | undefined = active.request.input
            ? typeof result?.value === "string"
                ? result.value.slice(0, active.request.input.maxLength ?? 200)
                : active.request.input.value ?? ""
            : (void 0);
        active.resolve({
            action,
            value,
        });
        this.destroyWindow();
    }

    /**
     * Rejects the active dialog because its window or parent disappeared.
     * @param error Failure surfaced to the original caller.
     */
    private rejectActive(error: Error): void {
        const active: ActiveDialog | null = this.active;
        if (!active) {
            return;
        }
        this.active = null;
        if (active.timer) {
            clearTimeout(active.timer);
        }
        active.reject(error);
    }

    /**
     * Handles the dialog renderer becoming ready for the request.
     */
    private handleReady(): void {
        if (!this.win || !this.active) {
            return;
        }
        if (this.active.timer) {
            clearTimeout(this.active.timer);
            this.active.timer = null;
        }
        this.position();
        this.win.webContents.send("dialog:request", this.active.request);
        this.win.show();
        this.win.focus();
        this.win.moveTop();
    }

    /**
     * Creates the dialog window when it is not alive.
     */
    private ensureWindow(): void {
        if (this.win && !this.win.isDestroyed()) {
            return;
        }
        if (!this.parent || this.parent.isDestroyed()) {
            return;
        }
        const win: BrowserWindow = createOverlayWindow({
            page: "dialog",
            width: WINDOW_WIDTH,
            height: WINDOW_HEIGHT,
            title: "Dialog",
            focusable: true,
            transparent: true,
            alwaysOnTop: true,
        });
        this.win = win;
        this.position();
        win.setAlwaysOnTop(true, "screen-saver");
        win.on("closed", () => {
            if (this.win !== win) {
                return;
            }
            const hadActive: boolean = this.active !== null;
            this.cleanupWindow();
            if (hadActive) {
                this.finish({
                    action: "cancel",
                });
            }
        });
        win.webContents.on("did-fail-load", (_event, errorCode: number, errorDescription: string, _url: string, isMainFrame: boolean) => {
            if (this.win !== win || !isMainFrame || errorCode === -3) {
                return;
            }
            this.rejectActive(new Error(`Dialog 窗口加载失败：${errorDescription}`));
            this.destroyWindow();
        });
        win.webContents.on("render-process-gone", (_event, details: Electron.RenderProcessGoneDetails) => {
            if (this.win !== win) {
                return;
            }
            this.rejectActive(new Error(`Dialog 渲染进程退出：${details.reason}`));
            this.destroyWindow();
        });
    }

    /**
     * Centers the independent dialog window on the main window's display.
     */
    private position(): void {
        if (!this.win || !this.parent || this.win.isDestroyed() || this.parent.isDestroyed()) {
            return;
        }
        const display: Electron.Display = screen.getDisplayMatching(this.parent.getBounds());
        placeWithin(this.win, display.workArea, {
            anchor: "center",
            width: WINDOW_WIDTH,
            height: WINDOW_HEIGHT,
        });
    }

    /**
     * Destroys the dialog window.
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
        this.win = null;
    }
}
