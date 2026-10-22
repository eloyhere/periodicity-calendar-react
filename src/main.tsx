import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { PeriodicityInternational, PeriodicityTheme } from "periodicity-react";
import "periodicity-react/styles.css";
import App from "./App.tsx";
import AppErrorBoundary from "./components/AppErrorBoundary.tsx";
import "./index.css";

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

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <PeriodicityTheme className="app-theme" theme="default" mode="light" density="compact">
            <PeriodicityInternational locale="zh-CN">
                <AppErrorBoundary>
                    <HashRouter>
                        <App />
                    </HashRouter>
                </AppErrorBoundary>
            </PeriodicityInternational>
        </PeriodicityTheme>
    </React.StrictMode>,
);

// Use contextBridge
window.ipcRenderer.on("main-process-message", (_event, message) => {
    console.log(message);
});
