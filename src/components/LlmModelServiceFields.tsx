import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
    PeriodicityButton,
    PeriodicityConfirmDialog,
    PeriodicitySelect,
    PeriodicityTextInput,
} from "periodicity-react";
import type { LlmPublicSettings } from "../../electron/llm/types";
import {
    findProvider,
    llmProviderOptions,
    resolveProviderId,
    type LlmProviderPreset,
} from "../config/llmProviders";
import type { LlmSettingsDraft } from "../hooks/useLlmSettingsDraft";
import { showToast } from "../notifications";

const customModelValue: string = "__custom__";
const emptyModels: readonly string[] = [];

interface ModelSelectOption {
    value: string;
    label: string;
}

interface LlmModelServiceFieldsProps {
    draft: LlmSettingsDraft;
    onConfirm: () => void;
}

function LlmModelServiceFields({ draft, onConfirm }: LlmModelServiceFieldsProps) {
    const [providerId, setProviderId]: [string, Dispatch<SetStateAction<string>>] = useState<string>(() => {
        return resolveProviderId(draft.baseUrl);
    });
    const [customModel, setCustomModel]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(() => {
        const initialProvider: LlmProviderPreset | undefined = findProvider(resolveProviderId(draft.baseUrl));
        return initialProvider === (void 0) || initialProvider.models.length === 0;
    });
    const [clearOpen, setClearOpen]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);

    const provider: LlmProviderPreset | undefined = findProvider(providerId);
    const presetModels: readonly string[] = provider === (void 0) ? emptyModels : provider.models;
    const missingBaseUrl: boolean = provider === (void 0) && draft.baseUrl.trim().length === 0;

    const modelOptions: readonly ModelSelectOption[] = useMemo((): readonly ModelSelectOption[] => {
        const values: string[] = [];
        if (draft.model.length > 0) {
            values.push(draft.model);
        }
        presetModels.forEach((model: string): void => {
            if (!values.includes(model)) {
                values.push(model);
            }
        });
        const options: ModelSelectOption[] = values.map((model: string): ModelSelectOption => {
            return { value: model, label: model };
        });
        options.push({ value: customModelValue, label: "自定义模型…" });
        return options;
    }, [draft.model, presetModels]);

    const handleProviderChange: (nextId: string) => void = (nextId: string): void => {
        setProviderId(nextId);
        const nextProvider: LlmProviderPreset | undefined = findProvider(nextId);
        if (nextProvider === (void 0)) {
            setCustomModel(true);
            return;
        }
        setCustomModel(false);
        draft.setBaseUrl(nextProvider.baseUrl);
        draft.setModel(nextProvider.defaultModel);
    };

    const handleModelChange: (value: string) => void = (value: string): void => {
        if (value === customModelValue) {
            setCustomModel(true);
            return;
        }
        setCustomModel(false);
        draft.setModel(value);
    };

    const clearStoredKey: () => Promise<void> = async (): Promise<void> => {
        const settings: LlmPublicSettings | null = await draft.clearApiKey();
        if (settings === null) {
            return;
        }
        setClearOpen(false);
        showToast({
            title: "已清除 API Key",
            description: "重新填写并确认后即可恢复模型调用。",
            tone: "success",
        });
    };

    const handleClearClick: () => void = (): void => {
        if (draft.hasKey) {
            setClearOpen(true);
            return;
        }
        draft.setApiKey("");
    };

    const confirmationDisabled: boolean = draft.saving || missingBaseUrl;
    const clearDisabled: boolean = draft.saving || (!draft.hasKey && draft.apiKey.length === 0);
    const clearLabel: string = draft.hasKey ? "清除已保存的 API Key" : "清空输入";
    const status: string = missingBaseUrl
        ? "自定义品牌需要先填写 API Base URL。"
        : draft.hasKey
            ? "Key 已保存在本机，可随时清除。"
            : "填写 Key 后点确认写入本机 userData。";
    const brandHint: string = provider === (void 0)
        ? "需要兼容 OpenAI /chat/completions 的服务。"
        : `接口地址：${draft.baseUrl.length > 0 ? draft.baseUrl : provider.baseUrl}`;
    const modelHint: string = customModel
        ? "填写服务端接受的模型 ID。"
        : presetModels.includes(draft.model)
            ? "列表来自品牌预设，也可切换为自定义模型。"
            : "当前模型不在品牌预设内，确认后会原样保留。";

    return (
        <div className="settings-model">
            <PeriodicitySelect
                label="模型品牌"
                value={providerId}
                options={llmProviderOptions}
                onChange={handleProviderChange}
                hint={brandHint}
            />
            {provider === (void 0) && (
                <PeriodicityTextInput
                    label="API Base URL"
                    value={draft.baseUrl}
                    onChange={(event) => {
                        draft.setBaseUrl(event.target.value);
                    }}
                    message="兼容 OpenAI /chat/completions 的自建网关或代理地址。"
                />
            )}
            <PeriodicityTextInput
                label="API Key"
                type="password"
                value={draft.apiKey}
                onChange={(event) => {
                    draft.setApiKey(event.target.value);
                }}
                message={draft.hasKey ? "已存在本地密钥，留空不会覆盖。" : "仅保存在本机 userData，不写入仓库。"}
            />
            <div className="settings-model__actions">
                <div className="settings-model__buttons">
                    <PeriodicityButton
                        className="settings-icon-button"
                        variant="solid"
                        size="md"
                        icon="Check"
                        aria-label="确认并保存模型设置"
                        title="确认并保存"
                        disabled={confirmationDisabled}
                        onClick={onConfirm}
                    />
                    <PeriodicityButton
                        className="settings-icon-button"
                        variant="outline"
                        size="md"
                        icon="Eraser"
                        aria-label={clearLabel}
                        title={clearLabel}
                        disabled={clearDisabled}
                        onClick={handleClearClick}
                    />
                </div>
                <span className="settings-model__status">{status}</span>
            </div>
            <PeriodicitySelect
                label="模型"
                value={customModel ? customModelValue : draft.model}
                options={modelOptions}
                onChange={handleModelChange}
                hint={modelHint}
            />
            {customModel && (
                <PeriodicityTextInput
                    label="模型名称"
                    value={draft.model}
                    onChange={(event) => {
                        draft.setModel(event.target.value);
                    }}
                    message="直接填写服务端支持的模型 ID，例如 deepseek-flash。"
                />
            )}
            <PeriodicityConfirmDialog
                open={clearOpen}
                onClose={() => {
                    setClearOpen(false);
                }}
                onConfirm={() => {
                    void clearStoredKey();
                }}
                title="清除本机 API Key？"
                description="清除后模型调用会提示缺少密钥，需要重新填写并确认。"
                confirmLabel="清除"
                cancelLabel="取消"
                tone="danger"
                loading={draft.saving}
            />
        </div>
    );
}

export default LlmModelServiceFields;
