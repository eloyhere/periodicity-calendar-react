import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
    DEFAULT_APP_PREFERENCES,
    type AppPreferences,
    type MotionPreference,
    type SaveAppPreferences,
    type ThemeModePreference,
} from "./types";

const PREFERENCES_FILE_NAME: string = "app-preferences.json";
const THEME_MODES: readonly ThemeModePreference[] = ["light", "dark", "system"];
const MOTION_MODES: readonly MotionPreference[] = ["system", "always", "reduce"];

/**
 * Resolves the JSON file that stores appearance preferences.
 * @return Absolute path inside the Electron userData directory.
 */
export function preferencesPath(): string {
    return path.join(app.getPath("userData"), PREFERENCES_FILE_NAME);
}

function isThemeMode(value: unknown): value is ThemeModePreference {
    return typeof value === "string" && THEME_MODES.includes(value as ThemeModePreference);
}

function isMotionPreference(value: unknown): value is MotionPreference {
    return typeof value === "string" && MOTION_MODES.includes(value as MotionPreference);
}

/**
 * Reads the stored appearance preferences with defaults for missing or invalid fields.
 * @return Stored preferences, or the documented defaults when the file is absent.
 */
export function loadPreferences(): AppPreferences {
    const fallback: AppPreferences = DEFAULT_APP_PREFERENCES;
    try {
        const raw: string = fs.readFileSync(preferencesPath(), "utf8");
        const parsed: Partial<AppPreferences> = JSON.parse(raw) as Partial<AppPreferences>;
        return {
            mode: isThemeMode(parsed.mode) ? parsed.mode : fallback.mode,
            motion: isMotionPreference(parsed.motion) ? parsed.motion : fallback.motion,
        };
    } catch {
        return {
            mode: fallback.mode,
            motion: fallback.motion,
        };
    }
}

/**
 * Merges the requested preferences into the stored file.
 * @param input Fields to overwrite; unknown values keep the stored preference.
 * @return The merged preferences that were written.
 */
export function savePreferences(input: SaveAppPreferences): AppPreferences {
    const existing: AppPreferences = loadPreferences();
    const next: AppPreferences = {
        mode: isThemeMode(input.mode) ? input.mode : existing.mode,
        motion: isMotionPreference(input.motion) ? input.motion : existing.motion,
    };
    fs.mkdirSync(path.dirname(preferencesPath()), { recursive: true });
    fs.writeFileSync(preferencesPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
}
