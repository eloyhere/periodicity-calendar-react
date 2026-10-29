import { app } from "electron";
import { settingsPath } from "../llm/settings";
import { preferencesPath } from "./preferences";
import type { AppInfo } from "./types";

/**
 * Collects the build and runtime facts rendered by the settings page.
 * @return Application name, versions, platform, and configuration file paths.
 */
export function collectAppInfo(): AppInfo {
    return {
        name: app.getName(),
        version: app.getVersion(),
        electron: process.versions.electron ?? "",
        chrome: process.versions.chrome ?? "",
        node: process.versions.node ?? "",
        platform: process.platform,
        arch: process.arch,
        userData: app.getPath("userData"),
        preferencesFile: preferencesPath(),
        settingsFile: settingsPath(),
    };
}
