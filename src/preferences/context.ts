import { createContext, useContext, type Context } from "react";
import type {
    AppPreferences,
    MotionPreference,
    SaveAppPreferences,
    ThemeModePreference,
} from "../../electron/settings/types";
import type { ResolvedThemeMode } from "./preferences";

/**
 * Preference state shared by the shell and every window that renders design system
 * components.
 * Type: interface.
 * @param preferences Stored preferences.
 * @param mode Stored palette preference.
 * @param motion Stored motion preference.
 * @param resolvedMode Concrete palette after resolving `system`.
 * @param systemDark Whether the platform currently prefers a dark palette.
 * @param systemReducedMotion Whether the platform currently asks for reduced motion.
 * @param saving Whether a preference write is in flight.
 * @param update Persists a partial preference change and applies it.
 */
export interface PreferencesContextValue {
    preferences: AppPreferences;
    mode: ThemeModePreference;
    motion: MotionPreference;
    resolvedMode: ResolvedThemeMode;
    systemDark: boolean;
    systemReducedMotion: boolean;
    saving: boolean;
    update: (input: SaveAppPreferences) => Promise<AppPreferences>;
}

export const PreferencesContext: Context<PreferencesContextValue | null> = createContext<PreferencesContextValue | null>(null);

/**
 * Reads the appearance preferences of the nearest provider.
 * @return Preference state and the update function.
 */
export function usePreferences(): PreferencesContextValue {
    const value: PreferencesContextValue | null = useContext(PreferencesContext);
    if (value === null) {
        throw new Error("usePreferences must be used inside PreferencesProvider.");
    }
    return value;
}
