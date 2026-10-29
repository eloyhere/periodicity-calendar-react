import React from "react";
import ReactDOM from "react-dom/client";
import "periodicity-react/styles.css";
import "./motion.css";
import type { AppPreferences } from "../electron/settings/types";
import AppShell from "./AppShell.tsx";
import { readPreferences } from "./preferences/preferences";
import "./index.css";
import "./window-interactions.css";

window.addEventListener("error", (event: ErrorEvent) => {
    window.daemon.report({
        kind: "renderer-error",
        message: event.message || "未捕获的渲染错误",
        stack: event.error instanceof Error ? event.error.stack : (void 0),
        source: "renderer:window",
    });
});

window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    window.daemon.report({
        kind: "renderer-error",
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : (void 0),
        source: "renderer:promise",
    });
});

/**
 * Loads the stored appearance preferences before the first paint, then mounts the app so
 * the shell never flashes the wrong palette.
 */
async function bootstrap(): Promise<void> {
    const preferences: AppPreferences = await readPreferences();
    ReactDOM.createRoot(document.getElementById("root")!).render(
        <React.StrictMode>
            <AppShell initial={preferences} />
        </React.StrictMode>,
    );
}

void bootstrap();

// Use contextBridge
window.ipcRenderer.on("main-process-message", (_event, message) => {
    console.log(message);
});
