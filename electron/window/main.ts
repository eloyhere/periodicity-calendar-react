import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { AmpEngine } from "../amp/engine";
import type { AmpActRequest, AmpAccountRequest, AmpLevel, AmpResolveRequest } from "../amp/types";
import { callModel } from "../llm/provider";
import { loadSettings, publicSettings, saveSettings } from "../llm/settings";
import type {
    AgentRunRequest,
    LlmChatRequest,
    LlmChatResult,
    LlmProviderResult,
    LlmSaveSettings,
    LlmSettings,
} from "../llm/types";
import { runAgent } from "../agent/runtime";
import { getWorkspaceInfo } from "../agent/tools";
import { DaemonProcess } from "../service/daemon";
import { DialogProcess } from "../service/dialog";
import { SnackbarProcess } from "../service/snackbar";
import { ToastProcess } from "../service/toast";
import {
    PRELOAD_PATH,
    RENDERER_DIST,
    VITE_DEV_SERVER_URL,
} from "./runtime";

const ampEngine: AmpEngine = new AmpEngine();
const snackbar: SnackbarProcess = new SnackbarProcess();
const toast: ToastProcess = new ToastProcess();
const dialog: DialogProcess = new DialogProcess();

let win: BrowserWindow | null = null;

/**
 * Reloads the main application window or recreates it after a crash.
 */
function reloadMainWindow(): void {
    if (win && !win.isDestroyed()) {
        try {
            win.webContents.reload();
            return;
        } catch {
            win.destroy();
            win = null;
        }
    }
    createWindow();
}

const daemon: DaemonProcess = new DaemonProcess(reloadMainWindow);

daemon.install();
daemon.register();
snackbar.register();
toast.register();
dialog.register();

ipcMain.on("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("window:toggle-maximize", (event) => {
    const targetWindow: BrowserWindow | null = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow) {
        return;
    }
    if (targetWindow.isMaximized()) {
        targetWindow.unmaximize();
    } else {
        targetWindow.maximize();
    }
});

ipcMain.on("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle("amp:init", () => {
    return ampEngine.init();
});

ipcMain.handle("amp:attend", (_event, intent: string, level: AmpLevel) => {
    return ampEngine.attend(intent, level);
});

ipcMain.handle("amp:act", (_event, request: AmpActRequest) => {
    return ampEngine.act(request);
});

ipcMain.handle("amp:resolve", (_event, request: AmpResolveRequest) => {
    return ampEngine.resolve(request);
});

ipcMain.handle("amp:account", (_event, request: AmpAccountRequest) => {
    return ampEngine.account(request);
});

ipcMain.handle("llm:get-settings", () => {
    return publicSettings();
});

ipcMain.handle("llm:save-settings", (_event, settings: LlmSaveSettings) => {
    return saveSettings(settings);
});

ipcMain.handle("llm:chat", async (_event, request: LlmChatRequest): Promise<LlmChatResult> => {
    const settings: LlmSettings = loadSettings();
    if (settings.apiKey.length === 0) {
        return {
            ok: false,
            content: "",
            error: "未配置模型 API Key。请打开设置填写。",
        };
    }
    try {
        const result: LlmProviderResult = await callModel(settings, request.messages);
        return {
            ok: true,
            content: result.content,
            usage: result.usage,
        };
    } catch (error: unknown) {
        return {
            ok: false,
            content: "",
            error: error instanceof Error ? error.message : "模型请求失败",
        };
    }
});

ipcMain.handle("agent:run", async (event, request: AgentRunRequest) => {
    return runAgent(request, (agentEvent) => {
        if (!event.sender.isDestroyed()) {
            event.sender.send("agent:event", agentEvent);
        }
    });
});

ipcMain.handle("workspace:info", () => {
    return getWorkspaceInfo(loadSettings().workspaceRoot);
});

function createWindow(): void {
    win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 640,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        backgroundMaterial: "acrylic",
        hasShadow: false,
        title: "Periodicity Calendar",
        icon: path.join(process.env.VITE_PUBLIC ?? "", "electron-vite.svg"),
        webPreferences: {
            preload: PRELOAD_PATH,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    // Remove the default menu bar on Windows/Linux.
    win.removeMenu();

    snackbar.attach(win);
    toast.attach(win);
    dialog.attach(win);
    daemon.attachMainWindow(win);

    win.on("maximize", () => {
        win?.webContents.send("window:maximized-changed", true);
    });

    win.on("unmaximize", () => {
        win?.webContents.send("window:maximized-changed", false);
    });

    win.on("closed", () => {
        snackbar.detach();
        toast.detach();
        dialog.detach();
        win = null;
    });

    // Test active push message to Renderer-process.
    win.webContents.on("did-finish-load", () => {
        win?.webContents.send("main-process-message", (new Date).toLocaleString());
        win?.webContents.send("window:maximized-changed", win?.isMaximized() ?? false);
    });

    if (VITE_DEV_SERVER_URL) {
        void win.loadURL(VITE_DEV_SERVER_URL).catch(() => {
            // The guardian reports did-fail-load.
        });
    } else {
        void win.loadFile(path.join(RENDERER_DIST, "index.html")).catch(() => {
            // The guardian reports did-fail-load.
        });
    }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("activate", () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (!win) {
        createWindow();
    }
});

void app.whenReady().then(() => {
    createWindow();
});
