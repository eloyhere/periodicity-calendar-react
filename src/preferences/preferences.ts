import {
    DEFAULT_APP_PREFERENCES,
    type AppPreferences,
    type MotionPreference,
    type ThemeModePreference,
} from "../../electron/settings/types";

/**
 * Concrete palette applied to the shell after resolving the stored preference.
 * Type: type alias.
 * Fields: light, dark.
 */
export type ResolvedThemeMode = "light" | "dark";

export const DARK_MODE_QUERY: string = "(prefers-color-scheme: dark)";
export const REDUCED_MOTION_QUERY: string = "(prefers-reduced-motion: reduce)";

/**
 * Reports whether the operating system currently prefers a dark palette.
 * @return True when `prefers-color-scheme` resolves to dark.
 */
export function systemPrefersDark(): boolean {
    if (typeof matchMedia !== "function") {
        return false;
    }
    return matchMedia(DARK_MODE_QUERY).matches;
}

/**
 * Reports whether the platform asks for reduced motion; Electron derives it from the
 * Windows "Animation effects" setting.
 * @return True when `prefers-reduced-motion` resolves to reduce.
 */
export function systemPrefersReducedMotion(): boolean {
    if (typeof matchMedia !== "function") {
        return false;
    }
    return matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Resolves the stored theme preference into a palette the theme provider can apply.
 * @param mode Stored palette preference.
 * @param prefersDark Current system palette choice; defaults to the live media query.
 * @return Concrete `light` or `dark` palette.
 */
export function resolveThemeMode(mode: ThemeModePreference, prefersDark: boolean = systemPrefersDark()): ResolvedThemeMode {
    if (mode === "system") {
        return prefersDark ? "dark" : "light";
    }
    return mode;
}

/**
 * Loads the persisted appearance preferences with a safe fallback.
 * @return Stored preferences, or the defaults when the main process is unavailable.
 */
export async function readPreferences(): Promise<AppPreferences> {
    try {
        return await window.preferences.get();
    } catch {
        return {
            mode: DEFAULT_APP_PREFERENCES.mode,
            motion: DEFAULT_APP_PREFERENCES.motion,
        };
    }
}

/**
 * Mirrors the motion preference onto the document so the design system can read it.
 * @param motion Stored motion preference.
 */
export function applyMotionPreference(motion: MotionPreference): void {
    const root: HTMLElement = document.documentElement;
    if (motion === "system") {
        root.removeAttribute("data-motion");
        return;
    }
    root.dataset.motion = motion;
}

/**
 * Mirrors the resolved palette onto the document so native widgets match the theme.
 * @param mode Concrete `light` or `dark` palette.
 */
export function applyColorScheme(mode: ResolvedThemeMode): void {
    document.documentElement.style.setProperty("color-scheme", mode);
}
