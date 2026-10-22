import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
    PeriodicityButton,
    PeriodicityCard,
    PeriodicityIcon,
    PeriodicityTag,
    PeriodicityTextArea,
} from "periodicity-react";
import type { PeriodicityIconName } from "periodicity-react";
import type {
    AgentEvent,
    AgentRunResult,
    LlmChatMessage,
    LlmPublicSettings,
    WorkspaceInfo,
} from "../../electron/llm/types";
import LlmSettingsDialog from "../components/LlmSettingsDialog";
import { showToast } from "../notifications";
import "./WorkflowPage.css";

interface AgentMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    time: string;
}

const TOOL_LABELS: readonly string[] = [
    "list_files",
    "read_file",
    "write_file",
    "replace_in_file",
    "search_files",
    "run_powershell",
    "git_status",
    "git_diff",
];

function nowLabel(): string {
    return new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function eventIcon(event: AgentEvent): PeriodicityIconName {
    if (event.type === "tool_call") {
        return "Play";
    }
    if (event.type === "tool_result") {
        return event.ok ? "Check" : "Error";
    }
    if (event.type === "error") {
        return "Error";
    }
    return "Check";
}

function eventTitle(event: AgentEvent): string {
    if (event.type === "tool_call") {
        return `调用 ${event.name}`;
    }
    if (event.type === "tool_result") {
        return `${event.ok ? "完成" : "失败"} ${event.name}`;
    }
    if (event.type === "error") {
        return "执行错误";
    }
    if (event.type === "final") {
        return "任务完成";
    }
    return "模型回复";
}

function WorkflowPage() {
    const [settings, setSettings]: [LlmPublicSettings | null, Dispatch<SetStateAction<LlmPublicSettings | null>>] = useState<LlmPublicSettings | null>(null);
    const [workspace, setWorkspace]: [WorkspaceInfo | null, Dispatch<SetStateAction<WorkspaceInfo | null>>] = useState<WorkspaceInfo | null>(null);
    const [messages, setMessages]: [AgentMessage[], Dispatch<SetStateAction<AgentMessage[]>>] = useState<AgentMessage[]>([
        {
            id: "welcome",
            role: "assistant",
            content: "我已连接到工作目录。给我一个任务，我会先看文件、再修改、再运行验证；失败会读错误并重试。",
            time: "现在",
        },
    ]);
    const [events, setEvents]: [AgentEvent[], Dispatch<SetStateAction<AgentEvent[]>>] = useState<AgentEvent[]>([]);
    const [prompt, setPrompt]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
    const [running, setRunning]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
    const [error, setError]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
    const [usage, setUsage]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
    const [settingsOpen, setSettingsOpen]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
    const composerRef: RefObject<HTMLTextAreaElement | null> = useRef<HTMLTextAreaElement | null>(null);

    const refreshWorkspace: () => Promise<void> = async () => {
        try {
            const info: WorkspaceInfo = await window.agent.workspace();
            setWorkspace(info);
        } catch (refreshError: unknown) {
            setError(refreshError instanceof Error ? refreshError.message : "读取工作目录失败");
        }
    };

    useEffect(() => {
        let cancelled: boolean = false;
        const load: () => Promise<void> = async () => {
            try {
                const current: LlmPublicSettings = await window.llm.getSettings();
                if (!cancelled) {
                    setSettings(current);
                }
                const info: WorkspaceInfo = await window.agent.workspace();
                if (!cancelled) {
                    setWorkspace(info);
                }
            } catch (loadError: unknown) {
                if (!cancelled) {
                    setError(loadError instanceof Error ? loadError.message : "初始化工作流失败");
                }
            }
        };
        void load();
        const unsubscribe: () => void = window.agent.onEvent((event: AgentEvent) => {
            setEvents((current) => {
                return [...current, event];
            });
        });
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, []);

    const handleRun: () => Promise<void> = async () => {
        const task: string = prompt.trim();
        if (task.length === 0 || running) {
            return;
        }
        const userMessage: AgentMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: task,
            time: nowLabel(),
        };
        const history: LlmChatMessage[] = [...messages, userMessage].map((message: AgentMessage): LlmChatMessage => {
            return {
                role: message.role,
                content: message.content,
            };
        });
        setMessages((current) => {
            return [...current, userMessage];
        });
        setPrompt("");
        setEvents([]);
        setUsage("");
        setError("");
        setRunning(true);
        try {
            const result: AgentRunResult = await window.agent.run({
                prompt: task,
                history,
            });
            if (result.content.length > 0) {
                setMessages((current) => {
                    return [
                        ...current,
                        {
                            id: crypto.randomUUID(),
                            role: "assistant",
                            content: result.content,
                            time: nowLabel(),
                        },
                    ];
                });
            }
            if (!result.ok) {
                setError(result.error ?? "工作流执行失败");
                showToast({
                    title: "工作流失败",
                    description: result.error ?? "执行失败",
                    tone: "danger",
                    duration: 7000,
                });
            } else {
                showToast({
                    title: "工作流完成",
                    description: result.usage
                        ? `${String(result.usage.total_tokens)} tokens`
                        : "任务已收敛",
                    tone: "success",
                });
            }
            if (result.usage) {
                setUsage(`${String(result.usage.prompt_tokens)} prompt · ${String(result.usage.completion_tokens)} completion · ${String(result.usage.total_tokens)} total`);
            }
            await refreshWorkspace();
        } catch (runError: unknown) {
            setError(runError instanceof Error ? runError.message : "工作流执行失败");
        } finally {
            setRunning(false);
        }
    };

    const toolEvents: AgentEvent[] = events.filter((event: AgentEvent): boolean => {
        return event.type === "tool_call" || event.type === "tool_result" || event.type === "error";
    });

    return (
        <div className="agent-main">
            <div className="agent-statusbar">
                <div className="agent-statusbar__facts">
                    <span><em>模型</em><strong>{settings?.model ?? "未配置"}</strong></span>
                    <span><em>工作区</em><strong>{workspace?.branch ?? "no git"}</strong></span>
                    <span><em>文件</em><strong>{workspace?.files.length ?? 0}</strong></span>
                    <span><em>运行时</em><strong>PowerShell + Git</strong></span>
                    <PeriodicityTag tone={running ? "primary" : settings?.hasKey ? "success" : "warning"} variant="outlined">
                        {running ? "运行中" : settings?.hasKey ? "就绪" : "缺少 Key"}
                    </PeriodicityTag>
                </div>
                <div className="agent-statusbar__actions">
                    <PeriodicityButton variant="ghost" icon="Refresh" onClick={() => { void refreshWorkspace(); }} disabled={running}>
                        刷新
                    </PeriodicityButton>
                    <PeriodicityButton variant="outline" icon="Sync" onClick={() => { setSettingsOpen(true); }}>
                        模型设置
                    </PeriodicityButton>
                    <PeriodicityButton
                        icon={settings?.hasKey ? "Play" : "Sync"}
                        onClick={() => {
                            if (settings?.hasKey) {
                                composerRef.current?.focus();
                                return;
                            }
                            setSettingsOpen(true);
                        }}
                    >
                        {settings?.hasKey ? "开始任务" : "配置模型"}
                    </PeriodicityButton>
                </div>
            </div>
            {!settings?.hasKey && (
                <div className="agent-banner agent-banner--warning">
                    <strong>缺少 API Key</strong>
                    <span>配置模型后才能运行工作流；所有文件工具仍限制在当前工作目录。</span>
                    <PeriodicityButton variant="outline" onClick={() => { setSettingsOpen(true); }}>
                                打开设置
                    </PeriodicityButton>
                </div>
            )}
            {error && (
                <div className="agent-banner agent-banner--error" role="alert">
                    <strong>执行失败</strong>
                    <span>{error}</span>
                </div>
            )}
            <div className="agent-grid">
                <div className="agent-column">
                    <PeriodicityCard
                        className="agent-card"
                        eyebrow="workspace"
                        title="工作目录"
                        action={<PeriodicityTag tone="neutral" variant="outlined">{workspace?.branch ?? "no git"}</PeriodicityTag>}
                    >
                        <code className="agent-root">{workspace?.root ?? "—"}</code>
                        <ul className="agent-files">
                            {(workspace?.files ?? []).slice(0, 80).map((file: string) => {
                                return <li key={file}>{file}</li>;
                            })}
                        </ul>
                    </PeriodicityCard>
                    <PeriodicityCard className="agent-card" eyebrow="git" title="变更">
                        <pre className="agent-git">{workspace?.gitStatus ?? "—"}</pre>
                    </PeriodicityCard>
                    <PeriodicityCard className="agent-card" eyebrow="self" title="我能做什么">
                        <div className="agent-tools">
                            {TOOL_LABELS.map((tool: string) => {
                                return (
                                    <span className="agent-tool" key={tool}>
                                        <PeriodicityIcon name="Check" size={14} />
                                        {tool}
                                    </span>
                                );
                            })}
                        </div>
                        <dl className="agent-facts">
                            <div><dt>read/write</dt><dd>workspace only</dd></div>
                            <div><dt>shell</dt><dd>PowerShell · 60s</dd></div>
                            <div><dt>git</dt><dd>status / diff</dd></div>
                            <div><dt>model</dt><dd>{settings?.model ?? "—"}</dd></div>
                        </dl>
                    </PeriodicityCard>
                </div>

                <div className="agent-column agent-column--chat">
                    <PeriodicityCard
                        className="agent-card agent-chat"
                        eyebrow="conversation"
                        title="与模型协作"
                        action={<PeriodicityTag tone={running ? "primary" : "neutral"} variant="outlined">{running ? "运行中" : "就绪"}</PeriodicityTag>}
                    >
                        <div className="agent-messages">
                            {messages.map((message: AgentMessage) => {
                                return (
                                    <article className={`agent-message agent-message--${message.role}`} key={message.id}>
                                        <header>
                                            <strong>{message.role === "user" ? "我" : "模型"}</strong>
                                            <span>{message.time}</span>
                                        </header>
                                        <p>{message.content}</p>
                                    </article>
                                );
                            })}
                            {running && (
                                <div className="agent-thinking">
                                    <PeriodicityIcon name="Sync" size={16} />
                                            模型正在读文件 / 运行命令…
                                </div>
                            )}
                        </div>
                        <div className="agent-composer">
                            <PeriodicityTextArea
                                ref={composerRef}
                                label="任务"
                                value={prompt}
                                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                                    setPrompt(event.target.value);
                                }}
                                rows={3}
                                maxLength={6000}
                                showCount
                                placeholder="例如：检查工作流页为什么报错，修复并运行 lint / build 验证。"
                            />
                            <div className="agent-composer__actions">
                                <span>{usage || "工具调用会实时出现在右侧轨迹。"}</span>
                                <PeriodicityButton icon="Play" onClick={() => { void handleRun(); }} disabled={running || prompt.trim().length === 0}>
                                    {running ? "运行中…" : "运行"}
                                </PeriodicityButton>
                            </div>
                        </div>
                    </PeriodicityCard>
                </div>

                <div className="agent-column">
                    <PeriodicityCard
                        className="agent-card"
                        eyebrow="trace"
                        title="运行轨迹"
                        action={<PeriodicityTag tone="neutral" variant="outlined">{toolEvents.length} 事件</PeriodicityTag>}
                    >
                        {toolEvents.length === 0 ? (
                            <p className="agent-empty">运行任务后，这里会显示每次工具调用与结果。</p>
                        ) : (
                            <div className="agent-trace">
                                {toolEvents.map((event, index: number) => {
                                    return (
                                        <article className={`agent-event agent-event--${event.type}`} key={`${event.type}-${String(index)}`}>
                                            <header>
                                                <PeriodicityIcon name={eventIcon(event)} size={14} />
                                                <strong>{eventTitle(event)}</strong>
                                            </header>
                                            {event.type === "tool_call" && <pre>{event.arguments}</pre>}
                                            {event.type === "tool_result" && (
                                                <>
                                                    <PeriodicityTag tone={event.ok ? "success" : "danger"} variant="outlined">
                                                        {event.ok ? "ok" : "error"} · {event.durationMs}ms
                                                    </PeriodicityTag>
                                                    <pre>{event.output.slice(0, 2500)}</pre>
                                                </>
                                            )}
                                            {event.type === "error" && <p>{event.message}</p>}
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                    </PeriodicityCard>
                    <PeriodicityCard className="agent-card" eyebrow="limits" title="边界">
                        <p className="agent-note">
                                    文件和 git 操作限制在工作目录；PowerShell 允许试错，但不会自动把密钥写进文件。
                                    每次修改后请让模型跑 lint / build。
                        </p>
                    </PeriodicityCard>
                </div>
            </div>
            <LlmSettingsDialog
                open={settingsOpen}
                onClose={() => {
                    setSettingsOpen(false);
                }}
                onSaved={(next: LlmPublicSettings) => {
                    setSettings(next);
                    setError("");
                    showToast({
                        title: "模型设置已保存",
                        description: next.model,
                        tone: "success",
                    });
                    void refreshWorkspace();
                }}
            />
        </div>
    );
}

export default WorkflowPage;
