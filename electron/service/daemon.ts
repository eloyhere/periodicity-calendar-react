import { app, clipboard, dialog as nativeDialog, ipcMain } from "electron";
import type { BrowserWindow, WebContents } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createOverlayWindow } from "../overlay/window";
import type {
    DaemonAction,
    DaemonErrorInput,
    DaemonErrorKind,
    DaemonErrorRecord,
    DaemonSnapshot,
} from "./types";

const MAX_ERRORS: number = 50;
const DEDUPE_WINDOW_MS: number = 2500;
const MAX_MESSAGE: number = 4000;
const MAX_STACK: number = 12000;

const ERROR_KINDS: readonly DaemonErrorKind[] = [
    "main-exception",
    "main-rejection",
    "renderer-error",
    "renderer-gone",
    "preload-error",
    "load-failure",
    "child-process-gone",
    "unresponsive",
];

/**
 * Trims and limits a string received from a renderer or the runtime.
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
 * Converts any thrown value into a message and optional stack.
 * @param reason Value thrown by the runtime or a renderer.
 * @return Human-readable description of the failure.
 */
function describeError(reason: unknown): { message: string; stack?: string } {
    if (reason instanceof Error) {
        return {
            message: reason.message || reason.name,
            stack: reason.stack,
        };
    }
    if (typeof reason === "string") {
        return {
            message: reason,
        };
    }
    try {
        return {
            message: JSON.stringify(reason) ?? String(reason),
        };
    } catch {
        return {
            message: String(reason),
        };
    }
}

/**
 * Reads the URL of a web contents without throwing after a crash.
 * @param contents Web contents that might already be destroyed.
 * @return The current URL or a stable fallback.
 */
function safeUrl(contents: WebContents): string {
    try {
        return contents.getURL() || "renderer";
    } catch {
        return "renderer";
    }
}

/**
 * Formats one error record for the clipboard.
 * @param record Error selected in the guardian window.
 * @return Plain-text diagnostic block.
 */
function formatForClipboard(record: DaemonErrorRecord): string {
    return [
        `[${record.at}] ${record.kind}`,
        record.message,
        record.source ? `source: ${record.source}` : "",
        record.stack ?? "",
    ].filter((line: string): boolean => {
        return line.length > 0;
    }).join("\n");
}

/**
 * Owns the guardian process and its dedicated error window.
 * The window is created on demand, so the guardian stays invisible while the
 * application is healthy and never keeps a hidden window alive at shutdown.
 */
export class DaemonProcess {
    private readonly reloadMain: () => void;
    private mainWindow: BrowserWindow | null = null;
    private win: BrowserWindow | null = null;
    private ready: boolean = false;
    private installed: boolean = false;
    private quitting: boolean = false;
    private errors: DaemonErrorRecord[] = [];
    private sequence: number = 0;
    private total: number = 0;
    private lastSignature: string = "";
    private lastAt: number = 0;
    private lastId: string = "";
    private pendingShow: boolean = false;
    private pendingFocus: boolean = false;

    /**
     * Creates the guardian with a callback that restores the main window.
     * @param reloadMain Reloads or recreates the main application window.
     */
    public constructor(reloadMain: () => void) {
        this.reloadMain = reloadMain;
    }

    /**
     * Installs global process, renderer, and page error handlers.
     */
    public install(): void {
        if (this.installed) {
            return;
        }
        this.installed = true;

        process.on("uncaughtException", (error: Error) => {
            this.report({
                kind: "main-exception",
                message: error.message || "主进程未捕获异常",
                stack: error.stack,
                source: "main",
                fatal: true,
            });
        });
        process.on("unhandledRejection", (reason: unknown) => {
            const described: { message: string; stack?: string } = describeError(reason);
            this.report({
                kind: "main-rejection",
                message: described.message,
                stack: described.stack,
                source: "main",
            });
        });

        app.on("before-quit", () => {
            this.quitting = true;
        });
        app.on("render-process-gone", (_event: Electron.Event, contents: WebContents, details: Electron.RenderProcessGoneDetails) => {
            this.handleRendererGone(contents, details);
        });
        app.on("child-process-gone", (_event: Electron.Event, details: Electron.Details) => {
            this.handleChildProcessGone(details);
        });
        app.on("web-contents-created", (_event: Electron.Event, contents: WebContents) => {
            this.watchContents(contents);
        });

        void app.whenReady().then(() => {
            if (this.pendingShow || this.errors.length > 0) {
                this.showWindow(this.pendingFocus);
            }
        });
    }

    /**
     * Registers the IPC surface used by renderers and the guardian window.
     */
    public register(): void {
        ipcMain.on("daemon:report", (event, input: DaemonErrorInput) => {
            if (this.win && event.sender === this.win.webContents) {
                return;
            }
            if (!input || typeof input !== "object") {
                return;
            }
            this.report({
                ...input,
                source: input.source || event.sender.getURL() || "renderer",
            });
        });
        ipcMain.on("daemon:ready", (event) => {
            if (this.win && event.sender === this.win.webContents) {
                this.ready = true;
                this.flushWindow();
            }
        });
        ipcMain.handle("daemon:snapshot", () => {
            return this.snapshot();
        });
        ipcMain.handle("daemon:action", (_event, action: DaemonAction, errorId?: string) => {
            this.handleAction(action, errorId);
        });
    }

    /**
     * Binds the guardian to the main window used by the reload action.
     * @param win Current main application window.
     */
    public attachMainWindow(win: BrowserWindow): void {
        this.mainWindow = win;
        win.once("closed", () => {
            if (this.mainWindow === win) {
                this.mainWindow = null;
                this.push();
            }
        });
        this.push();
    }

    /**
     * Records one error and opens the guardian window.
     * @param input Error details supplied by the runtime or a renderer.
     */
    public report(input: DaemonErrorInput): void {
        if (!input || typeof input !== "object") {
            return;
        }
        const kind: DaemonErrorKind = ERROR_KINDS.includes(input.kind as DaemonErrorKind)
            ? (input.kind as DaemonErrorKind)
            : "renderer-error";
        const message: string = cleanText(input.message, MAX_MESSAGE) || "未提供错误信息";
        const signature: string = `${kind}:${message}`;
        const now: number = Date.now();
        if (signature === this.lastSignature && now - this.lastAt < DEDUPE_WINDOW_MS) {
            const existing: DaemonErrorRecord | undefined = this.errors.find((record: DaemonErrorRecord): boolean => {
                return record.id === this.lastId;
            });
            if (existing) {
                existing.count += 1;
                existing.at = new Date(now).toISOString();
                existing.fatal = existing.fatal === true || input.fatal === true;
            }
            this.lastAt = now;
            this.push();
            this.showWindow(false);
            return;
        }

        this.sequence += 1;
        const record: DaemonErrorRecord = {
            id: `err-${String(this.sequence)}`,
            at: new Date(now).toISOString(),
            sequence: this.sequence,
            count: 1,
            kind,
            message,
            stack: cleanText(input.stack, MAX_STACK) || (void 0),
            source: cleanText(input.source, 500) || "unknown",
            detail: cleanText(input.detail, 2000) || (void 0),
            fatal: input.fatal === true,
        };
        this.errors.push(record);
        this.total += 1;
        if (this.errors.length > MAX_ERRORS) {
            this.errors.splice(0, this.errors.length - MAX_ERRORS);
        }
        this.lastSignature = signature;
        this.lastAt = now;
        this.lastId = record.id;
        this.appendLog(record);
        this.push();
        this.showWindow(true);
    }

    /**
     * Opens the guardian window and sends it the latest snapshot.
     * @param focus Whether the window should take keyboard focus.
     */
    private showWindow(focus: boolean): void {
        if (this.quitting) {
            return;
        }
        if (!app.isReady()) {
            this.pendingShow = true;
            this.pendingFocus = this.pendingFocus || focus;
            return;
        }
        try {
            this.ensureWindow();
        } catch (error: unknown) {
            const described: { message: string; stack?: string } = describeError(error);
            nativeDialog.showErrorBox("守护进程不可用", described.message);
            return;
        }
        if (!this.win || this.win.isDestroyed()) {
            return;
        }
        if (!this.ready) {
            this.pendingShow = true;
            this.pendingFocus = this.pendingFocus || focus;
            return;
        }
        this.push();
        this.win.show();
        if (focus) {
            this.win.focus();
        }
        this.win.moveTop();
    }

    /**
     * Flushes the first snapshot once the guardian renderer is ready.
     */
    private flushWindow(): void {
        if (!this.win || this.win.isDestroyed()) {
            return;
        }
        this.push();
        if (!this.pendingShow && this.errors.length === 0) {
            return;
        }
        this.pendingShow = false;
        this.win.show();
        if (this.pendingFocus) {
            this.pendingFocus = false;
            this.win.focus();
        }
        this.win.moveTop();
    }

    /**
     * Creates the guardian window when it is not alive.
     */
    private ensureWindow(): void {
        if (this.win && !this.win.isDestroyed()) {
            return;
        }
        const win: BrowserWindow = createOverlayWindow({
            page: "daemon",
            width: 860,
            height: 600,
            title: "守护进程",
            focusable: true,
            resizable: true,
            movable: true,
            transparent: false,
            backgroundColor: "#0d131a",
            hasShadow: true,
            skipTaskbar: false,
            minWidth: 620,
            minHeight: 420,
            center: true,
            thickFrame: true,
        });
        this.win = win;
        this.ready = false;
        win.center();
        win.on("closed", () => {
            if (this.win === win) {
                this.win = null;
                this.ready = false;
            }
        });
        win.webContents.on("preload-error", (_event, preloadPath: string, error: Error) => {
            nativeDialog.showErrorBox("守护进程 preload 失败", `${preloadPath}\n${error.message}`);
            if (this.win === win) {
                this.win = null;
                this.ready = false;
            }
            if (!win.isDestroyed()) {
                win.destroy();
            }
        });
        win.webContents.on("did-fail-load", (_event, errorCode: number, errorDescription: string, _url: string, isMainFrame: boolean) => {
            if (this.win !== win || this.quitting || !isMainFrame || errorCode === -3) {
                return;
            }
            nativeDialog.showErrorBox("守护进程窗口加载失败", `${errorDescription} (${String(errorCode)})`);
            if (!win.isDestroyed()) {
                win.destroy();
            }
            if (this.win === win) {
                this.win = null;
                this.ready = false;
            }
        });

    }

    /**
     * Sends the current snapshot to the guardian renderer.
     */
    private push(): void {
        if (!this.win || this.win.isDestroyed() || !this.ready) {
            return;
        }
        this.win.webContents.send("daemon:snapshot", this.snapshot());
    }

    /**
     * Builds the immutable state consumed by the guardian renderer.
     * @return Current errors and runtime metadata.
     */
    private snapshot(): DaemonSnapshot {
        return {
            errors: [...this.errors].reverse(),
            appVersion: app.getVersion(),
            electronVersion: process.versions.electron,
            platform: process.platform,
            mainWindowAlive: this.mainWindow !== null && !this.mainWindow.isDestroyed(),
            logPath: this.logPath(),
            total: this.total,
        };
    }

    /**
     * Handles one action requested by the guardian window.
     * @param action Dismiss, reload, copy, or quit.
     * @param errorId Optional error selected in the window.
     */
    private handleAction(action: DaemonAction, errorId?: string): void {
        if (action === "dismiss") {
            this.closeWindow();
            return;
        }
        if (action === "reload") {
            try {
                this.reloadMain();
            } catch (error: unknown) {
                const described: { message: string; stack?: string } = describeError(error);
                this.report({
                    kind: "renderer-error",
                    message: `重新加载主窗口失败：${described.message}`,
                    stack: described.stack,
                    source: "daemon",
                });
                return;
            }
            this.closeWindow();
            return;
        }
        if (action === "quit") {
            this.quitting = true;
            app.exit(1);
            return;
        }
        if (action === "copy") {
            const record: DaemonErrorRecord | undefined = errorId
                ? this.errors.find((entry: DaemonErrorRecord): boolean => {
                    return entry.id === errorId;
                })
                : this.errors[this.errors.length - 1];
            if (record) {
                clipboard.writeText(formatForClipboard(record));
            }
        }
    }

    /**
     * Closes the guardian window without quitting the application.
     */
    private closeWindow(): void {
        if (this.win && !this.win.isDestroyed()) {
            this.win.destroy();
        }
        this.win = null;
        this.ready = false;
    }

    /**
     * Handles a renderer process disappearing.
     * @param contents Renderer that exited.
     * @param details Exit reason and code.
     */
    private handleRendererGone(contents: WebContents, details: Electron.RenderProcessGoneDetails): void {
        if (this.quitting || details.reason === "clean-exit" || details.reason === "killed") {
            return;
        }
        if (this.win && contents === this.win.webContents) {
            const failedWindow: BrowserWindow = this.win;
            this.win = null;
            this.ready = false;
            nativeDialog.showErrorBox("守护进程窗口异常", `渲染进程退出：${details.reason}`);
            if (!failedWindow.isDestroyed()) {
                failedWindow.destroy();
            }
            return;
        }
        this.report({
            kind: "renderer-gone",
            message: `渲染进程退出：${details.reason}（exit ${String(details.exitCode)}）`,
            source: safeUrl(contents),
            fatal: details.reason === "crashed" || details.reason === "oom",
        });
    }

    /**
     * Handles a non-renderer child process disappearing.
     * @param details Process type, name, reason, and exit code.
     */
    private handleChildProcessGone(details: Electron.Details): void {
        if (this.quitting || details.reason === "clean-exit" || details.reason === "killed") {
            return;
        }
        const name: string = details.name || details.serviceName || details.type;
        this.report({
            kind: "child-process-gone",
            message: `${name} 进程退出：${details.reason}（exit ${String(details.exitCode)}）`,
            source: "main",
        });
    }

    /**
     * Watches one web contents for preload, load, and responsiveness failures.
     * @param contents Web contents created by Electron.
     */
    private watchContents(contents: WebContents): void {
        if (contents.getType() !== "window") {
            return;
        }
        contents.on("preload-error", (_event, preloadPath: string, error: Error) => {
            if (this.win && contents === this.win.webContents) {
                return;
            }
            this.report({
                kind: "preload-error",
                message: `preload 执行失败：${preloadPath}`,
                stack: error.stack,
                source: safeUrl(contents),
                fatal: true,
            });
        });
        contents.on("did-fail-load", (_event, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => {
            if (this.win && contents === this.win.webContents) {
                return;
            }
            if (!isMainFrame || errorCode === -3) {
                return;
            }
            this.report({
                kind: "load-failure",
                message: `页面加载失败：${validatedURL}（${errorDescription} ${String(errorCode)}）`,
                source: safeUrl(contents),
            });
        });
        contents.on("unresponsive", () => {
            if (this.win && contents === this.win.webContents) {
                return;
            }
            this.report({
                kind: "unresponsive",
                message: "页面失去响应。",
                source: safeUrl(contents),
            });
        });
    }

    /**
     * Returns the path of the append-only guardian log.
     * @return Absolute log path, or a relative fallback.
     */
    private logPath(): string {
        try {
            return path.join(app.getPath("userData"), "daemon-errors.log");
        } catch {
            return "daemon-errors.log";
        }
    }

    /**
     * Appends one error record to the on-disk diagnostic log.
     * @param record Error to persist.
     */
    private appendLog(record: DaemonErrorRecord): void {
        try {
            const file: string = this.logPath();
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.appendFileSync(
                file,
                `${record.at} [${record.kind}] seq=${String(record.sequence)} ${record.message}\n${record.stack ?? ""}\n`,
                "utf8",
            );
        } catch {
            // Diagnostics must never make error handling fail.
        }
    }
}
