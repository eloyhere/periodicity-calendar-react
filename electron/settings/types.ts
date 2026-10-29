/**
 * Palette preference stored for the desktop shell.
 * Type: type alias.
 * Fields: light, dark, system.
 * @example
 * const mode: ThemeModePreference = "system";
 */
export type ThemeModePreference = "light" | "dark" | "system";

/**
 * How the shell resolves the motion preference.
 * Type: type alias.
 * Fields: system (follow the platform), always (force full motion), reduce (force reduced
 * motion).
 * @example
 * const motion: MotionPreference = "always";
 */
export type MotionPreference = "system" | "always" | "reduce";

/**
 * Appearance preferences persisted next to the model settings.
 * Type: interface.
 * @param mode Stored palette preference.
 * @param motion Stored motion preference.
 * @example
 * const preferences: AppPreferences = { mode: "light", motion: "system" };
 */
export interface AppPreferences {
    mode: ThemeModePreference;
    motion: MotionPreference;
}

/**
 * Partial preferences written by the settings page.
 * Type: interface.
 * @param mode New palette preference; omitted fields keep their stored value.
 * @param motion New motion preference; omitted fields keep their stored value.
 * @example
 * const input: SaveAppPreferences = { motion: "always" };
 */
export interface SaveAppPreferences {
    mode?: ThemeModePreference;
    motion?: MotionPreference;
}

/**
 * Build and runtime facts rendered by the About section.
 * Type: interface.
 * Fields: name, version, electron, chrome, node, platform, arch, userData, preferencesFile,
 * settingsFile.
 * @example
 * const info: AppInfo = await window.appInfo.get();
 */
export interface AppInfo {
    name: string;
    version: string;
    electron: string;
    chrome: string;
    node: string;
    platform: string;
    arch: string;
    userData: string;
    preferencesFile: string;
    settingsFile: string;
}

/**
 * Preferences used until the user stores their own choice.
 * Type: constant.
 * @example
 * const initial: AppPreferences = DEFAULT_APP_PREFERENCES;
 */
export const DEFAULT_APP_PREFERENCES: AppPreferences = {
    mode: "light",
    motion: "system",
};

/**
 * Bridge exposed by the preload script for appearance preferences.
 * Type: interface.
 * Fields: get, save.
 */
export interface PreferencesApi {
    get: () => Promise<AppPreferences>;
    save: (input: SaveAppPreferences) => Promise<AppPreferences>;
}

/**
 * Bridge exposed by the preload script for build and runtime facts.
 * Type: interface.
 * Fields: get.
 */
export interface AppInfoApi {
    get: () => Promise<AppInfo>;
}
