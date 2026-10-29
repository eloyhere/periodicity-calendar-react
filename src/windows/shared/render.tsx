import { StrictMode, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { PeriodicityInternational, PeriodicityTheme } from "periodicity-react";
import "periodicity-react/styles.css";
import "../../motion.css";
import "./window.css";
import type { AppPreferences } from "../../../electron/settings/types";
import { applyMotionPreference, readPreferences, resolveThemeMode } from "../../preferences/preferences";

export interface OverlayRenderOptions {
    mode?: "light" | "dark";
    windowClass?: string;
}

/**
 * Applies the theme class to the document so portalled overlays inherit tokens.
 * @param mode Resolved colour mode.
 * @param windowClass Optional window-specific document class.
 */
function applyDocumentTheme(mode: "light" | "dark", windowClass: string): void {
    const root: HTMLElement = document.documentElement;
    root.classList.add("periodicity-theme", "overlay-window");
    if (windowClass.length > 0) {
        root.classList.add(windowClass);
    }
    root.dataset.theme = mode;
    root.dataset.density = "regular";
    root.dataset.radius = "default";
    root.style.setProperty("color-scheme", mode);
}

/**
 * Reports uncaught overlay errors to the guardian process.
 * @param source Stable label identifying the reporting window.
 */
function installOverlayErrorReporting(source: string): void {
    window.addEventListener("error", (event: ErrorEvent) => {
        window.daemon.report({
            kind: "renderer-error",
            message: event.message || "未捕获的窗口渲染错误",
            stack: event.error instanceof Error ? event.error.stack : (void 0),
            source,
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
}

/**
 * Applies the stored theme and motion preferences, then renders one overlay window entry.
 * @param container Mount node of the overlay window.
 * @param element Window-specific React tree.
 * @param options Colour mode override and optional document class.
 * @param windowClass Resolved document class.
 */
async function mountOverlay(
    container: HTMLElement,
    element: ReactNode,
    options: OverlayRenderOptions,
    windowClass: string,
): Promise<void> {
    const preferences: AppPreferences = await readPreferences();
    const mode: "light" | "dark" = options.mode ?? resolveThemeMode(preferences.mode);
    applyDocumentTheme(mode, windowClass);
    applyMotionPreference(preferences.motion);
    ReactDOM.createRoot(container).render(
        <StrictMode>
            <PeriodicityTheme className="overlay-theme" theme="default" mode={mode}>
                <PeriodicityInternational locale="zh-CN">{element}</PeriodicityInternational>
            </PeriodicityTheme>
        </StrictMode>,
    );
}

/**
 * Renders one overlay window entry with the shared theme and locale providers.
 * @param element Window-specific React tree.
 * @param options Colour mode and optional document class.
 */
export function renderOverlay(element: ReactNode, options: OverlayRenderOptions = {}): void {
    const windowClass: string = options.windowClass ?? "";
    if (windowClass !== "daemon-window") {
        installOverlayErrorReporting(windowClass.length > 0 ? `overlay:${windowClass}` : "overlay");
    }
    const container: HTMLElement | null = document.getElementById("root");
    if (!container) {
        throw new Error("Overlay root element is missing.");
    }
    void mountOverlay(container, element, options, windowClass);
}
