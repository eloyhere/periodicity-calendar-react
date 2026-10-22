import { ipcRenderer, contextBridge } from "electron";
import { PROGRESS_CHANNEL, type ProgressUpdate } from "../progress";
import type {
    AmpAccountRequest,
    AmpActRequest,
    AmpEngineApi,
    AmpLevel,
    AmpResolveRequest,
    AmpResponse,
} from "../amp/types";
import type {
    AgentApi,
    AgentEvent,
    AgentRunRequest,
    AgentRunResult,
    LlmApi,
    LlmChatRequest,
    LlmChatResult,
    LlmPublicSettings,
    LlmSaveSettings,
    WorkspaceInfo,
} from "../llm/types";
import type {
    DaemonAction,
    DaemonApi,
    DaemonErrorInput,
    DaemonSnapshot,
    DialogApi,
    DialogOptions,
    DialogResult,
    SnackbarApi,
    SnackbarCloseReason,
    SnackbarOptions,
    SnackbarResult,
    SnackbarState,
    ToastApi,
    ToastDismissReason,
    ToastItem,
    ToastOptions,
    ToastResult,
} from "../service/types";

/**
 * Subscribes to one main-process channel.
 * @param channel IPC channel name.
 * @param callback Receiver of the event payload.
 * @return Cleanup function that removes the listener.
 */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
    const listener: (_event: Electron.IpcRendererEvent, payload: T) => void = (_event, payload) => {
        callback(payload);
    };
    ipcRenderer.on(channel, listener);
    return (): void => {
        ipcRenderer.removeListener(channel, listener);
    };
}

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld("ipcRenderer", {
    on(...args: Parameters<typeof ipcRenderer.on>) {
        const [channel, listener]: Parameters<typeof ipcRenderer.on> = args;
        return ipcRenderer.on(channel, (event, ...args) => {
            return listener(event, ...args);
        });
    },
    off(...args: Parameters<typeof ipcRenderer.off>) {
        const [channel, ...omit]: Parameters<typeof ipcRenderer.off> = args;
        return ipcRenderer.off(channel, ...omit);
    },
    send(...args: Parameters<typeof ipcRenderer.send>) {
        const [channel, ...omit]: Parameters<typeof ipcRenderer.send> = args;
        return ipcRenderer.send(channel, ...omit);
    },
    invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
        const [channel, ...omit]: Parameters<typeof ipcRenderer.invoke> = args;
        return ipcRenderer.invoke(channel, ...omit);
    },
});

contextBridge.exposeInMainWorld("windowControls", {
    minimize() {
        ipcRenderer.send("window:minimize");
    },
    toggleMaximize() {
        ipcRenderer.send("window:toggle-maximize");
    },
    close() {
        ipcRenderer.send("window:close");
    },
    onMaximizedChange(callback: (maximized: boolean) => void) {
        ipcRenderer.on("window:maximized-changed", (_event, maximized: boolean) => {
            callback(maximized);
        });
    },
});

contextBridge.exposeInMainWorld("progress", {
    onUpdate(callback: (update: ProgressUpdate) => void) {
        ipcRenderer.on(PROGRESS_CHANNEL, (_event, update: ProgressUpdate) => {
            callback(update);
        });
    },
});

const amp: AmpEngineApi = {
    init(): Promise<AmpResponse> {
        return ipcRenderer.invoke("amp:init") as Promise<AmpResponse>;
    },
    attend(intent: string, level: AmpLevel): Promise<AmpResponse> {
        return ipcRenderer.invoke("amp:attend", intent, level) as Promise<AmpResponse>;
    },
    act(request: AmpActRequest): Promise<AmpResponse> {
        return ipcRenderer.invoke("amp:act", request) as Promise<AmpResponse>;
    },
    resolve(request: AmpResolveRequest): Promise<AmpResponse> {
        return ipcRenderer.invoke("amp:resolve", request) as Promise<AmpResponse>;
    },
    account(request: AmpAccountRequest): Promise<AmpResponse> {
        return ipcRenderer.invoke("amp:account", request) as Promise<AmpResponse>;
    },
};

contextBridge.exposeInMainWorld("amp", amp);

const llm: LlmApi = {
    getSettings(): Promise<LlmPublicSettings> {
        return ipcRenderer.invoke("llm:get-settings") as Promise<LlmPublicSettings>;
    },
    saveSettings(settings: LlmSaveSettings): Promise<LlmPublicSettings> {
        return ipcRenderer.invoke("llm:save-settings", settings) as Promise<LlmPublicSettings>;
    },
    chat(request: LlmChatRequest): Promise<LlmChatResult> {
        return ipcRenderer.invoke("llm:chat", request) as Promise<LlmChatResult>;
    },
};

contextBridge.exposeInMainWorld("llm", llm);

const agent: AgentApi = {
    run(request: AgentRunRequest): Promise<AgentRunResult> {
        return ipcRenderer.invoke("agent:run", request) as Promise<AgentRunResult>;
    },
    onEvent(callback: (event: AgentEvent) => void): () => void {
        const listener: (_event: Electron.IpcRendererEvent, event: AgentEvent) => void = (_event, event) => {
            callback(event);
        };
        ipcRenderer.on("agent:event", listener);
        return () => {
            ipcRenderer.removeListener("agent:event", listener);
        };
    },
    workspace(): Promise<WorkspaceInfo> {
        return ipcRenderer.invoke("workspace:info") as Promise<WorkspaceInfo>;
    },
};

contextBridge.exposeInMainWorld("agent", agent);

const snackbar: SnackbarApi = {
    show(options: SnackbarOptions): Promise<SnackbarResult> {
        return ipcRenderer.invoke("snackbar:show", options) as Promise<SnackbarResult>;
    },
    hide(): void {
        ipcRenderer.send("snackbar:hide");
    },
    onUpdate(callback: (state: SnackbarState | null) => void): () => void {
        return subscribe<SnackbarState | null>("snackbar:update", callback);
    },
    ready(): void {
        ipcRenderer.send("snackbar:ready");
    },
    resize(height: number): void {
        ipcRenderer.send("snackbar:resize", height);
    },
    closed(reason: SnackbarCloseReason): void {
        ipcRenderer.send("snackbar:closed", reason);
    },
};

contextBridge.exposeInMainWorld("snackbar", snackbar);

const toast: ToastApi = {
    show(options: ToastOptions): Promise<ToastResult> {
        return ipcRenderer.invoke("toast:show", options) as Promise<ToastResult>;
    },
    dismiss(id: string): void {
        ipcRenderer.send("toast:dismiss", id);
    },
    onUpdate(callback: (items: ToastItem[]) => void): () => void {
        return subscribe<ToastItem[]>("toast:update", callback);
    },
    ready(): void {
        ipcRenderer.send("toast:ready");
    },
    resize(height: number): void {
        ipcRenderer.send("toast:resize", height);
    },
    closed(id: string, reason: ToastDismissReason): void {
        ipcRenderer.send("toast:closed", id, reason);
    },
};

contextBridge.exposeInMainWorld("toast", toast);

const dialog: DialogApi = {
    open(options: DialogOptions): Promise<DialogResult> {
        return ipcRenderer.invoke("dialog:open", options) as Promise<DialogResult>;
    },
    onRequest(callback: (options: DialogOptions) => void): () => void {
        return subscribe<DialogOptions>("dialog:request", callback);
    },
    ready(): void {
        ipcRenderer.send("dialog:ready");
    },
    resolve(result: DialogResult): void {
        ipcRenderer.send("dialog:resolve", result);
    },
};

contextBridge.exposeInMainWorld("dialog", dialog);

const daemon: DaemonApi = {
    report(error: DaemonErrorInput): void {
        ipcRenderer.send("daemon:report", error);
    },
    onSnapshot(callback: (snapshot: DaemonSnapshot) => void): () => void {
        return subscribe<DaemonSnapshot>("daemon:snapshot", callback);
    },
    ready(): void {
        ipcRenderer.send("daemon:ready");
    },
    action(action: DaemonAction, errorId?: string): Promise<void> {
        return ipcRenderer.invoke("daemon:action", action, errorId) as Promise<void>;
    },
};

contextBridge.exposeInMainWorld("daemon", daemon);
