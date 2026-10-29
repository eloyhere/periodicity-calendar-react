/**
 * One selectable model provider preset.
 * Type: interface.
 * @param id Stable identifier used by the brand select.
 * @param label Brand name shown in the select.
 * @param baseUrl OpenAI-compatible API root written to the settings file.
 * @param models Models offered by the brand preset.
 * @param defaultModel Model selected when the user picks the brand.
 */
export interface LlmProviderPreset {
    id: string;
    label: string;
    baseUrl: string;
    models: readonly string[];
    defaultModel: string;
}

/**
 * One option rendered by the brand select.
 * Type: interface.
 * @param value Provider id or the custom sentinel.
 * @param label Visible option text.
 */
export interface LlmProviderOption {
    value: string;
    label: string;
}

/**
 * Sentinel used when the API root does not match a known brand.
 * Type: constant.
 */
export const customProviderId: string = "custom";

/**
 * Brands whose API also speaks the OpenAI /chat/completions format.
 * Model ids follow each provider's current catalogue; the model select still
 * accepts a custom id so a newly released model never blocks the user.
 * Type: constant.
 */
export const llmProviderPresets: readonly LlmProviderPreset[] = [
    {
        id: "deepseek",
        label: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
        models: ["deepseek-flash", "deepseek-v4-pro"],
        defaultModel: "deepseek-flash",
    },
    {
        id: "openai",
        label: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        models: ["gpt-5.5", "gpt-5", "gpt-4.1"],
        defaultModel: "gpt-5.5",
    },
    {
        id: "anthropic",
        label: "Anthropic Claude",
        baseUrl: "https://api.anthropic.com/v1",
        models: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
        defaultModel: "claude-sonnet-4-5",
    },
    {
        id: "google",
        label: "Google Gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        models: ["gemini-3.5-pro", "gemini-3.5-flash", "gemini-3-pro"],
        defaultModel: "gemini-3.5-pro",
    },
    {
        id: "kimi",
        label: "Moonshot Kimi",
        baseUrl: "https://api.moonshot.cn/v1",
        models: ["kimi-k3", "kimi-k3.1-pro", "kimi-k2.7-code"],
        defaultModel: "kimi-k3",
    },
    {
        id: "qwen",
        label: "通义千问 Qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        models: ["qwen3.8-max", "qwen3.7-plus", "qwen3.8-flash"],
        defaultModel: "qwen3.8-max",
    },
    {
        id: "zhipu",
        label: "智谱 GLM",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        models: ["glm-5.3", "glm-5.3-flash", "glm-5.2"],
        defaultModel: "glm-5.3",
    },
];

/**
 * Brand select options: every known brand followed by the custom sentinel.
 * Type: constant.
 */
export const llmProviderOptions: readonly LlmProviderOption[] = [
    ...llmProviderPresets.map((provider: LlmProviderPreset): LlmProviderOption => {
        return { value: provider.id, label: provider.label };
    }),
    { value: customProviderId, label: "自定义（OpenAI 兼容）" },
];

/**
 * Normalizes one API root for comparison.
 * @param value Raw base URL.
 * @return Lower-cased, trimmed URL without trailing slashes.
 */
function normalizeUrl(value: string): string {
    return value.trim().toLowerCase().replace(/\/+$/, "");
}

/**
 * Looks up one brand preset by id.
 * @param id Provider identifier.
 * @return Matching preset, or undefined for the custom provider.
 */
export function findProvider(id: string): LlmProviderPreset | undefined {
    return llmProviderPresets.find((provider: LlmProviderPreset): boolean => {
        return provider.id === id;
    });
}

/**
 * Infers which brand owns a stored API root.
 * @param baseUrl API root from the settings file.
 * @return The matching provider id, or the custom sentinel.
 */
export function resolveProviderId(baseUrl: string): string {
    const normalized: string = normalizeUrl(baseUrl);
    if (normalized.length === 0) {
        return customProviderId;
    }
    const matched: LlmProviderPreset | undefined = llmProviderPresets.find((provider: LlmProviderPreset): boolean => {
        const presetUrl: string = normalizeUrl(provider.baseUrl);
        return normalized === presetUrl || normalized.startsWith(`${presetUrl}/`);
    });
    return matched === (void 0) ? customProviderId : matched.id;
}
