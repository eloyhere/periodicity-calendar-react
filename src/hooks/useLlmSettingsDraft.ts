import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { LlmPublicSettings } from "../../electron/llm/types";

/**
 * Editable model settings shared by the settings dialog and the settings page.
 * Type: interface.
 * @param baseUrl OpenAI-compatible API root.
 * @param model Chat completion model name.
 * @param apiKey Pending key; an empty value keeps the stored key.
 * @param workspaceRoot Directory used by every workflow file tool.
 * @param hasKey Whether a key is already stored on disk.
 * @param loading Whether the first read is still in flight.
 * @param saving Whether a write is in flight.
 * @param error Last read or write failure, empty when the draft is healthy.
 * @param reload Re-reads the stored settings into the draft.
 * @param save Writes the draft and returns the persisted settings, or null on failure.
 * @param clearApiKey Deletes the stored key and returns the remaining settings, or null on failure.
 */
export interface LlmSettingsDraft {
    baseUrl: string;
    model: string;
    apiKey: string;
    workspaceRoot: string;
    hasKey: boolean;
    loading: boolean;
    saving: boolean;
    error: string;
    setBaseUrl: Dispatch<SetStateAction<string>>;
    setModel: Dispatch<SetStateAction<string>>;
    setApiKey: Dispatch<SetStateAction<string>>;
    setWorkspaceRoot: Dispatch<SetStateAction<string>>;
    reload: () => Promise<void>;
    save: () => Promise<LlmPublicSettings | null>;
    clearApiKey: () => Promise<LlmPublicSettings | null>;
}

/**
 * Options accepted by the draft hook.
 * Type: interface.
 * @param enabled When false the hook waits before reading, so a closed dialog stays idle.
 */
export interface LlmSettingsDraftOptions {
    enabled?: boolean;
}

/**
 * Loads and edits the model settings that the dialog and the settings page share.
 * @param options Set `enabled` to false to defer the read until the editor opens.
 * @return Draft state, setters, reload, and save.
 */
export function useLlmSettingsDraft(options: LlmSettingsDraftOptions = {}): LlmSettingsDraft {
    const enabled: boolean = options.enabled ?? true;
    const [baseUrl, setBaseUrl]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
    const [model, setModel]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
    const [apiKey, setApiKey]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
    const [workspaceRoot, setWorkspaceRoot]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
    const [hasKey, setHasKey]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
    const [loading, setLoading]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(enabled);
    const [saving, setSaving]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
    const [error, setError]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");

    const reload: () => Promise<void> = useCallback(async (): Promise<void> => {
        setLoading(true);
        try {
            const settings: LlmPublicSettings = await window.llm.getSettings();
            setBaseUrl(settings.baseUrl);
            setModel(settings.model);
            setWorkspaceRoot(settings.workspaceRoot);
            setHasKey(settings.hasKey);
            setApiKey("");
            setError("");
        } catch (loadError: unknown) {
            setError(loadError instanceof Error ? loadError.message : "读取设置失败");
        } finally {
            setLoading(false);
        }
    }, []);

    const save: () => Promise<LlmPublicSettings | null> = useCallback(async (): Promise<LlmPublicSettings | null> => {
        setSaving(true);
        setError("");
        try {
            const settings: LlmPublicSettings = await window.llm.saveSettings({
                baseUrl,
                model,
                apiKey,
                workspaceRoot,
            });
            setBaseUrl(settings.baseUrl);
            setModel(settings.model);
            setWorkspaceRoot(settings.workspaceRoot);
            setHasKey(settings.hasKey);
            setApiKey("");
            return settings;
        } catch (saveError: unknown) {
            setError(saveError instanceof Error ? saveError.message : "保存设置失败");
            return null;
        } finally {
            setSaving(false);
        }
    }, [apiKey, baseUrl, model, workspaceRoot]);

    const clearApiKey: () => Promise<LlmPublicSettings | null> = useCallback(async (): Promise<LlmPublicSettings | null> => {
        setSaving(true);
        setError("");
        try {
            const settings: LlmPublicSettings = await window.llm.clearApiKey();
            setHasKey(settings.hasKey);
            setApiKey("");
            return settings;
        } catch (clearError: unknown) {
            setError(clearError instanceof Error ? clearError.message : "清除密钥失败");
            return null;
        } finally {
            setSaving(false);
        }
    }, []);

    useEffect(() => {
        if (!enabled) {
            return;
        }
        void reload();
    }, [enabled, reload]);

    return {
        baseUrl,
        model,
        apiKey,
        workspaceRoot,
        hasKey,
        loading,
        saving,
        error,
        setBaseUrl,
        setModel,
        setApiKey,
        setWorkspaceRoot,
        reload,
        save,
        clearApiKey,
    };
}
