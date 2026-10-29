import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import {
    PeriodicityAlert,
    PeriodicityButton,
    PeriodicityCard,
    PeriodicitySelect,
    PeriodicityTag,
    PeriodicityTextInput,
} from "periodicity-react";
import type { LlmPublicSettings, WorkspaceInfo } from "../../electron/llm/types";
import type { NotificationPlatformInfo } from "../../electron/service/types";
import type {
    AppInfo,
    MotionPreference,
    SaveAppPreferences,
    ThemeModePreference,
} from "../../electron/settings/types";
import { useLlmSettingsDraft, type LlmSettingsDraft } from "../hooks/useLlmSettingsDraft";
import LlmModelServiceFields from "../components/LlmModelServiceFields";
import { showToast } from "../notifications";
import { usePreferences, type PreferencesContextValue } from "../preferences/context";
import "./SettingsPage.css";

interface SettingsOption {
    value: string;
    label: string;
}

const THEME_OPTIONS: readonly SettingsOption[] = [
    { value: "light", label: "浅色" },
    { value: "dark", label: "深色" },
    { value: "system", label: "跟随系统" },
];

const MOTION_OPTIONS: readonly SettingsOption[] = [
    { value: "system", label: "跟随系统" },
    { value: "always", label: "始终播放" },
    { value: "reduce", label: "减少动画" },
];

/**
 * Narrows one select value back to a theme preference.
 * @param value Raw select value.
 * @return Stored theme preference, defaulting to light.
 */
function toThemeMode(value: string): ThemeModePreference {
    if (value === "dark" || value === "system") {
        return value;
    }
    return "light";
}

/**
 * Narrows one select value back to a motion preference.
 * @param value Raw select value.
 * @return Stored motion preference, defaulting to the platform setting.
 */
function toMotionPreference(value: string): MotionPreference {
    if (value === "always" || value === "reduce") {
        return value;
    }
    return "system";
}

/**
 * Renders one label/value row inside a facts list.
 * @param props Row label and the value to show.
 * @return Definition-list row.
 */
function SettingFact({ label, value }: { label: string; value: string }) {
    return (
        <div className="settings-fact">
            <dt className="settings-fact__label">{label}</dt>
            <dd className="settings-fact__value">{value}</dd>
        </div>
    );
}

function SettingsPage() {
    const draft: LlmSettingsDraft = useLlmSettingsDraft();
    const preferences: PreferencesContextValue = usePreferences();
    const { update, mode, motion, systemDark, systemReducedMotion, saving: preferenceSaving }: PreferencesContextValue = preferences;
    const navigate: ReturnType<typeof useNavigate> = useNavigate();
    const [workspace, setWorkspace]: [WorkspaceInfo | null, Dispatch<SetStateAction<WorkspaceInfo | null>>] = useState<WorkspaceInfo | null>(null);
    const [workspaceBusy, setWorkspaceBusy]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
    const [appInfo, setAppInfo]: [AppInfo | null, Dispatch<SetStateAction<AppInfo | null>>] = useState<AppInfo | null>(null);
    const [platform, setPlatform]: [NotificationPlatformInfo | null, Dispatch<SetStateAction<NotificationPlatformInfo | null>>] = useState<NotificationPlatformInfo | null>(null);

    useEffect(() => {
        let cancelled: boolean = false;
        const load: () => Promise<void> = async (): Promise<void> => {
            try {
                const info: AppInfo = await window.appInfo.get();
                if (!cancelled) {
                    setAppInfo(info);
                }
            } catch {
                // The About card keeps its placeholders when the bridge is unavailable.
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled: boolean = false;
        void window.notification.platformInfo().then((info: NotificationPlatformInfo): void => {
            if (!cancelled) {
                setPlatform(info);
            }
        }).catch((): void => {
            // Notification support is optional; the card degrades to placeholders.
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const refreshWorkspace: () => Promise<void> = useCallback(async (): Promise<void> => {
        setWorkspaceBusy(true);
        try {
            const info: WorkspaceInfo = await window.agent.workspace();
            setWorkspace(info);
        } catch {
            setWorkspace(null);
        } finally {
            setWorkspaceBusy(false);
        }
    }, []);

    useEffect(() => {
        void refreshWorkspace();
    }, [refreshWorkspace]);

    const handleSave: () => Promise<void> = async (): Promise<void> => {
        const settings: LlmPublicSettings | null = await draft.save();
        if (settings === null) {
            return;
        }
        showToast({
            title: "设置已保存",
            description: settings.model,
            tone: "success",
        });
        void refreshWorkspace();
    };

    const updatePreferences: (input: SaveAppPreferences) => Promise<void> = useCallback(async (input: SaveAppPreferences): Promise<void> => {
        try {
            await update(input);
        } catch (error: unknown) {
            showToast({
                title: "外观设置保存失败",
                description: error instanceof Error ? error.message : "无法写入偏好设置",
                tone: "danger",
            });
        }
    }, [update]);

    return (
        <section className="settings-page">
            <div className="settings-page__inner">
                <PeriodicityCard
                    className="settings-card"
                    eyebrow="MODEL"
                    title="模型服务"
                    action={
                        <PeriodicityTag tone={draft.hasKey ? "success" : "warning"} variant="outlined">
                            {draft.loading ? "读取中…" : draft.hasKey ? "API Key 已配置" : "缺少 API Key"}
                        </PeriodicityTag>
                    }
                >
                    {draft.loading ? (
                        <p className="settings-model__loading">正在读取本机模型配置…</p>
                    ) : (
                        <LlmModelServiceFields
                            draft={draft}
                            onConfirm={() => {
                                void handleSave();
                            }}
                        />
                    )}
                    {draft.error.length > 0 && (
                        <div className="settings-model__error">
                            <PeriodicityAlert tone="danger" title="设置操作失败" description={draft.error} />
                        </div>
                    )}
                </PeriodicityCard>

                <PeriodicityCard
                    className="settings-card"
                    eyebrow="WORKSPACE"
                    title="工作目录"
                    action={
                        <PeriodicityTag tone={workspace !== null && workspace.hasGit ? "success" : "neutral"} variant="outlined">
                            {workspaceBusy ? "检测中…" : workspace !== null && workspace.hasGit ? "git 就绪" : "无 git 仓库"}
                        </PeriodicityTag>
                    }
                    footer={
                        <div className="settings-card__actions">
                            <span className="settings-card__status">文件读写、PowerShell、git 都以此目录为根。</span>
                            <PeriodicityButton variant="ghost" icon="Sync" disabled={workspaceBusy} onClick={() => { void refreshWorkspace(); }}>
                                {workspaceBusy ? "检测中…" : "重新检测"}
                            </PeriodicityButton>
                            <PeriodicityButton variant="outline" icon="Folder" disabled={draft.saving} onClick={() => { void handleSave(); }}>
                                保存目录
                            </PeriodicityButton>
                        </div>
                    }
                >
                    <div className="settings-form">
                        <PeriodicityTextInput
                            label="工作目录"
                            value={draft.workspaceRoot}
                            onChange={(event) => {
                                draft.setWorkspaceRoot(event.target.value);
                            }}
                            hint="R:\\project\\..."
                            message="更改后需要保存；文件工具在下次运行时使用新目录。"
                        />
                    </div>
                    <dl className="settings-facts">
                        <SettingFact label="根目录" value={workspace === null ? "未检测" : workspace.root} />
                        <SettingFact label="分支" value={workspace === null || !workspace.hasGit || workspace.branch.length === 0 ? "—" : workspace.branch} />
                        <SettingFact label="文件" value={workspace === null ? "—" : `${String(workspace.files.length)} 个`} />
                        <SettingFact label="git" value={workspace === null ? "—" : workspace.hasGit ? workspace.gitStatus : "未检测到 git"} />
                    </dl>
                </PeriodicityCard>

                <PeriodicityCard
                    className="settings-card"
                    eyebrow="APPEARANCE"
                    title="外观与动效"
                    action={
                        <PeriodicityTag tone={preferenceSaving ? "neutral" : "success"} variant="outlined">
                            {preferenceSaving ? "保存中…" : "已自动保存"}
                        </PeriodicityTag>
                    }
                >
                    <div className="settings-form settings-form--inline">
                        <PeriodicitySelect
                            label="主题模式"
                            value={mode}
                            options={THEME_OPTIONS}
                            onChange={(value: string) => {
                                void updatePreferences({ mode: toThemeMode(value) });
                            }}
                            hint="跟随系统时随 Windows 的明暗模式切换。"
                        />
                        <PeriodicitySelect
                            label="动效"
                            value={motion}
                            options={MOTION_OPTIONS}
                            onChange={(value: string) => {
                                void updatePreferences({ motion: toMotionPreference(value) });
                            }}
                            hint="始终播放会忽略系统的减少动效请求。"
                        />
                    </div>
                    <dl className="settings-facts">
                        <SettingFact label="系统明暗" value={systemDark ? "深色" : "浅色"} />
                        <SettingFact label="系统动效" value={systemReducedMotion ? "请求减少" : "允许动画"} />
                    </dl>
                    <p className="settings-hint">
                        Windows 关闭「设置 → 辅助功能 → 视觉效果 → 动画效果」时，Electron 会向页面报告减少动效，
                        悬浮与点击 ripple 仍会显示，但时长会缩短到 0.5 秒；选择「始终播放」可恢复完整的 1 秒动画。
                    </p>
                </PeriodicityCard>

                <PeriodicityCard
                    className="settings-card"
                    eyebrow="SYSTEM"
                    title="系统集成"
                    action={
                        <PeriodicityTag tone={platform !== null && platform.supported ? "success" : "neutral"} variant="outlined">
                            {platform === null ? "读取中…" : platform.supported ? "通知可用" : "通知不可用"}
                        </PeriodicityTag>
                    }
                >
                    <dl className="settings-facts">
                        <SettingFact label="通知平台" value={platform === null ? "读取中…" : `${platform.label} ${platform.version}`} />
                        <SettingFact label="标识" value={platform === null ? "—" : platform.id} />
                        <SettingFact label="签名" value={platform === null ? "—" : platform.requiresCodeSigning ? "需要代码签名" : "无需代码签名"} />
                    </dl>
                    <div className="settings-card__actions settings-card__actions--start">
                        <PeriodicityButton variant="ghost" icon="Bell" onClick={() => { navigate("/call-test"); }}>
                            打开 CallTest
                        </PeriodicityButton>
                        <PeriodicityButton variant="outline" onClick={() => { void window.notification.openSettings(); }}>
                            系统通知设置
                        </PeriodicityButton>
                    </div>
                </PeriodicityCard>

                <PeriodicityCard
                    className="settings-card"
                    eyebrow="ABOUT"
                    title="关于"
                    action={
                        <PeriodicityTag tone="neutral" variant="outlined">
                            {appInfo === null ? "读取中…" : `v${appInfo.version}`}
                        </PeriodicityTag>
                    }
                >
                    <dl className="settings-facts">
                        <SettingFact label="应用" value={appInfo === null ? "—" : appInfo.name} />
                        <SettingFact label="Electron" value={appInfo === null ? "—" : appInfo.electron} />
                        <SettingFact label="Chromium" value={appInfo === null ? "—" : appInfo.chrome} />
                        <SettingFact label="Node" value={appInfo === null ? "—" : appInfo.node} />
                        <SettingFact label="平台" value={appInfo === null ? "—" : `${appInfo.platform} · ${appInfo.arch}`} />
                        <SettingFact label="配置目录" value={appInfo === null ? "—" : appInfo.userData} />
                        <SettingFact label="偏好文件" value={appInfo === null ? "—" : appInfo.preferencesFile} />
                        <SettingFact label="模型设置" value={appInfo === null ? "—" : appInfo.settingsFile} />
                    </dl>
                </PeriodicityCard>
            </div>
        </section>
    );
}

export default SettingsPage;
