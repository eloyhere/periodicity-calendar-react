import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
    PeriodicityButton,
    PeriodicityDialog,
    PeriodicityTextInput,
} from "periodicity-react";
import type { LlmPublicSettings } from "../../electron/llm/types";
import "./LlmSettingsDialog.css";

interface LlmSettingsDialogProps {
    open: boolean;
    onClose: () => void;
    onSaved: (settings: LlmPublicSettings) => void;
}

function LlmSettingsDialog({ open, onClose, onSaved }: LlmSettingsDialogProps) {
    const [baseUrl, setBaseUrl]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
    const [model, setModel]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
    const [apiKey, setApiKey]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
    const [workspaceRoot, setWorkspaceRoot]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
    const [hasKey, setHasKey]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
    const [saving, setSaving]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
    const [error, setError]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");

    useEffect(() => {
        if (!open) {
            return;
        }
        let cancelled: boolean = false;
        const load: () => Promise<void> = async () => {
            try {
                const settings: LlmPublicSettings = await window.llm.getSettings();
                if (cancelled) {
                    return;
                }
                setBaseUrl(settings.baseUrl);
                setModel(settings.model);
                setWorkspaceRoot(settings.workspaceRoot);
                setHasKey(settings.hasKey);
                setApiKey("");
                setError("");
            } catch (loadError: unknown) {
                if (!cancelled) {
                    setError(loadError instanceof Error ? loadError.message : "读取设置失败");
                }
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [open]);

    const handleSave: () => Promise<void> = async () => {
        setSaving(true);
        setError("");
        try {
            const settings: LlmPublicSettings = await window.llm.saveSettings({
                baseUrl,
                model,
                apiKey,
                workspaceRoot,
            });
            onSaved(settings);
            onClose();
        } catch (saveError: unknown) {
            setError(saveError instanceof Error ? saveError.message : "保存设置失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <PeriodicityDialog
            open={open}
            onClose={onClose}
            title="模型与工作目录"
            eyebrow="LLM SETTINGS"
            description="Key 只在主进程使用，不写入仓库。工作流的所有文件工具都被限制在这个目录内。"
            size="md"
            footer={
                <div className="llm-settings__actions">
                    <PeriodicityButton variant="ghost" onClick={onClose} disabled={saving}>
                        取消
                    </PeriodicityButton>
                    <PeriodicityButton icon="Check" onClick={() => { void handleSave(); }} disabled={saving}>
                        {saving ? "保存中…" : "保存"}
                    </PeriodicityButton>
                </div>
            }
        >
            <div className="llm-settings">
                <PeriodicityTextInput
                    label="API Base URL"
                    value={baseUrl}
                    onChange={(event) => {
                        setBaseUrl(event.target.value);
                    }}
                    hint="https://api.deepseek.com/v1"
                    message="兼容 OpenAI /chat/completions 的服务"
                />
                <PeriodicityTextInput
                    label="模型"
                    value={model}
                    onChange={(event) => {
                        setModel(event.target.value);
                    }}
                    hint="deepseek-chat"
                />
                <PeriodicityTextInput
                    label="API Key"
                    type="password"
                    value={apiKey}
                    onChange={(event) => {
                        setApiKey(event.target.value);
                    }}
                    hint={hasKey ? "已保存；留空则保持不变" : "sk-..."}
                    message={hasKey ? "已存在本地密钥，留空不会覆盖。" : "仅保存在本机 userData。"}
                />
                <PeriodicityTextInput
                    label="工作目录"
                    value={workspaceRoot}
                    onChange={(event) => {
                        setWorkspaceRoot(event.target.value);
                    }}
                    hint="R:\\project\\..."
                    message="文件读写、PowerShell、git 都以此目录为根。"
                />
                {error && <p className="llm-settings__error" role="alert">{error}</p>}
            </div>
        </PeriodicityDialog>
    );
}

export default LlmSettingsDialog;
