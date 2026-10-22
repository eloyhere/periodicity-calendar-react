/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
    interface ProcessEnv {
        /**
         * The built directory structure
         *
         * ```tree
         * ├─┬─┬ dist
         * │ │ └── index.html
         * │ │
         * │ ├─┬─ dist-electron
         * │ │ ├── main.js
         * │ │ └── preload.js
         * │
         * ```
         */
        APP_ROOT: string;
        /** /dist/ or /public/ */
        VITE_PUBLIC: string;
    }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
    ipcRenderer: import("electron").IpcRenderer;
    windowControls: {
        minimize: () => void;
        toggleMaximize: () => void;
        close: () => void;
        onMaximizedChange: (callback: (maximized: boolean) => void) => void;
    };
    progress: {
        onUpdate: (callback: (update: import("../progress").ProgressUpdate) => void) => void;
    };
    amp: import("../amp/types").AmpEngineApi;
    llm: import("../llm/types").LlmApi;
    agent: import("../llm/types").AgentApi;
    snackbar: import("../service/types").SnackbarApi;
    toast: import("../service/types").ToastApi;
    dialog: import("../service/types").DialogApi;
    daemon: import("../service/types").DaemonApi;
    notification: import("../service/types").SystemNotificationApi;
}
