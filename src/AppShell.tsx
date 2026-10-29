import { HashRouter } from "react-router-dom";
import { PeriodicityInternational, PeriodicityTheme } from "periodicity-react";
import type { AppPreferences } from "../electron/settings/types";
import App from "./App.tsx";
import AppErrorBoundary from "./components/AppErrorBoundary.tsx";
import PreferencesProvider from "./preferences/PreferencesProvider";
import { usePreferences, type PreferencesContextValue } from "./preferences/context";

/**
 * Props for the application shell.
 * Type: interface.
 * @param initial Appearance preferences read before the first render.
 */
export interface AppShellProps {
    initial: AppPreferences;
}

/**
 * Renders the themed provider stack from the resolved appearance preferences.
 * @return Theme, locale, error boundary, and router around the pages.
 */
function ThemedRoutes() {
    const { resolvedMode }: PreferencesContextValue = usePreferences();
    return (
        <PeriodicityTheme className="app-theme" theme="default" mode={resolvedMode}>
            <PeriodicityInternational locale="zh-CN">
                <AppErrorBoundary>
                    <HashRouter>
                        <App />
                    </HashRouter>
                </AppErrorBoundary>
            </PeriodicityInternational>
        </PeriodicityTheme>
    );
}

/**
 * Mounts the preference provider above the themed routes.
 * @param props Initial appearance preferences.
 * @return The application shell.
 */
function AppShell({ initial }: AppShellProps) {
    return (
        <PreferencesProvider initial={initial}>
            <ThemedRoutes />
        </PreferencesProvider>
    );
}

export default AppShell;
