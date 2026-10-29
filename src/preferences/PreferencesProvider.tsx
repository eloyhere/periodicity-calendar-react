import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { AppPreferences, SaveAppPreferences } from "../../electron/settings/types";
import { PreferencesContext, type PreferencesContextValue } from "./context";
import {
    applyColorScheme,
    applyMotionPreference,
    DARK_MODE_QUERY,
    REDUCED_MOTION_QUERY,
    resolveThemeMode,
    systemPrefersDark,
    systemPrefersReducedMotion,
    type ResolvedThemeMode,
} from "./preferences";

/**
 * Props for the appearance preference provider.
 * Type: interface.
 * @param initial Preferences loaded before the first render; avoids a theme flash.
 * @param children Tree that receives the preference context.
 */
export interface PreferencesProviderProps {
    initial: AppPreferences;
    children: ReactNode;
}

/**
 * Holds the appearance preferences, mirrors them onto the document, and exposes the
 * update function used by the settings page.
 * @param props Initial preferences and the React tree to configure.
 * @return Context provider for the application shell.
 */
function PreferencesProvider({ initial, children }: PreferencesProviderProps) {
    const [preferences, setPreferences]: [AppPreferences, Dispatch<SetStateAction<AppPreferences>>] = useState<AppPreferences>(initial);
    const [systemDark, setSystemDark]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>((): boolean => {
        return systemPrefersDark();
    });
    const [systemReducedMotion, setSystemReducedMotion]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>((): boolean => {
        return systemPrefersReducedMotion();
    });
    const [saving, setSaving]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
    const resolvedMode: ResolvedThemeMode = resolveThemeMode(preferences.mode, systemDark);

    useEffect(() => {
        const query: MediaQueryList = matchMedia(DARK_MODE_QUERY);
        const handleChange: (event: MediaQueryListEvent) => void = (event: MediaQueryListEvent): void => {
            setSystemDark(event.matches);
        };
        query.addEventListener("change", handleChange);
        return () => {
            query.removeEventListener("change", handleChange);
        };
    }, []);

    useEffect(() => {
        const query: MediaQueryList = matchMedia(REDUCED_MOTION_QUERY);
        const handleChange: (event: MediaQueryListEvent) => void = (event: MediaQueryListEvent): void => {
            setSystemReducedMotion(event.matches);
        };
        query.addEventListener("change", handleChange);
        return () => {
            query.removeEventListener("change", handleChange);
        };
    }, []);

    useEffect(() => {
        applyMotionPreference(preferences.motion);
    }, [preferences.motion]);

    useEffect(() => {
        applyColorScheme(resolvedMode);
    }, [resolvedMode]);

    const update: (input: SaveAppPreferences) => Promise<AppPreferences> = useCallback(async (input: SaveAppPreferences): Promise<AppPreferences> => {
        setSaving(true);
        try {
            const next: AppPreferences = await window.preferences.save(input);
            setPreferences(next);
            return next;
        } finally {
            setSaving(false);
        }
    }, []);

    const value: PreferencesContextValue = useMemo<PreferencesContextValue>((): PreferencesContextValue => {
        return {
            preferences,
            mode: preferences.mode,
            motion: preferences.motion,
            resolvedMode,
            systemDark,
            systemReducedMotion,
            saving,
            update,
        };
    }, [preferences, resolvedMode, systemDark, systemReducedMotion, saving, update]);

    return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export default PreferencesProvider;
