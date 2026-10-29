import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import {
    PeriodicityAlert,
    PeriodicityButton,
    PeriodicityCard,
    PeriodicityEmptyState,
    PeriodicityMarkdown,
    PeriodicityMessageList,
    PeriodicityRing,
    PeriodicityTag,
    PeriodicityTerminal,
    PeriodicityTextArea,
    PeriodicityTimeline,
    PeriodicityToolbar,
} from "periodicity-react";
import type { PeriodicityIconName } from "periodicity-react";
import type {
    AgentEvent,
    AgentRunResult,
    LlmChatMessage,
    LlmPublicSettings,
    WorkspaceInfo,
} from "../../electron/llm/types";
import { showSystemNotification, showToast } from "../notifications";
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
    const navigate: ReturnType<typeof useNavigate> = useNavigate();
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
    const [pickingWorkspace, setPickingWorkspace]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
    const [error, setError]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
    const [usage, setUsage]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
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

    const handlePickWorkspace: () => Promise<void> = async (): Promise<void> => {
        if (pickingWorkspace || running) {
            return;
        }
        setPickingWorkspace(true);
        try {
            const picked: string | null = await window.agent.pickDirectory();
            if (picked === null) {
                return;
            }
            const current: LlmPublicSettings = await window.llm.getSettings();
            const saved: LlmPublicSettings = await window.llm.saveSettings({
                baseUrl: current.baseUrl,
                model: current.model,
                apiKey: "",
                workspaceRoot: picked,
            });
            setSettings(saved);
            await refreshWorkspace();
            showToast({
                title: "工作区已切换",
                description: picked,
                tone: "success",
            });
        } catch (pickError: unknown) {
            const message: string = pickError instanceof Error ? pickError.message : "选择工作区失败";
            setError(message);
            showToast({
                title: "选择工作区失败",
                description: message,
                tone: "danger",
            });
        } finally {
            setPickingWorkspace(false);
        }
    };

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
            void showSystemNotification({
                title: result.ok ? "工作流完成" : "工作流失败",
                body: result.ok
                    ? result.usage
                        ? `${String(result.usage.total_tokens)} tokens`
                        : "任务已收敛"
                    : result.error ?? "执行失败",
                whenUnfocused: true,
            });
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
                <PeriodicityToolbar content={
                    <div className="agent-statusbar__facts">
                        <span><em>模型</em><strong>{settings?.model ?? "未配置"}</strong></span>
                        <span><em>工作区</em><strong>{workspace?.branch ?? "no git"}</strong></span>
                        <span><em>文件</em><strong>{workspace?.files.length ?? 0}</strong></span>
                        <span><em>运行时</em><strong>PowerShell + Git</strong></span>
                        <PeriodicityTag tone={running ? "primary" : settings?.hasKey ? "success" : "warning"} variant="outlined">
                            {running ? "运行中" : settings?.hasKey ? "就绪" : "缺少 Key"}
                        </PeriodicityTag>
                    </div>
                } suffix={
                    <div className="agent-statusbar__actions">
                        <PeriodicityButton variant="ghost" icon="Refresh" onClick={() => { void refreshWorkspace(); }} disabled={running}>
                            刷新
                        </PeriodicityButton>
                        <PeriodicityButton variant="outline" icon="Folder" onClick={() => { void handlePickWorkspace(); }} disabled={running || pickingWorkspace}>
                            {pickingWorkspace ? "选择中…" : "选择工作区"}
                        </PeriodicityButton>
                        <PeriodicityButton
                            icon={settings?.hasKey ? "Play" : "Setting"}
                            onClick={() => {
                                if (settings?.hasKey) {
                                    composerRef.current?.focus();
                                    return;
                                }
                                navigate("/settings");
                            }}
                        >
                            {settings?.hasKey ? "开始任务" : "去设置"}
                        </PeriodicityButton>
                    </div>
                } />
            </div>
            {!settings?.hasKey && (
                <div className="agent-banner">
                    <PeriodicityAlert
                        tone="warning"
                        title="缺少 API Key"
                        description="配置模型后才能运行工作流；所有文件工具仍限制在当前工作目录。"
                        action={<PeriodicityButton variant="outline" onClick={() => { navigate("/settings"); }}>打开设置</PeriodicityButton>}
                    />
                </div>
            )}
            {error && (
                <div className="agent-banner">
                    <PeriodicityAlert tone="danger" title="执行失败" description={error} />
                </div>
            )}
            <div className="agent-grid">
                <div className="agent-column">
                    <div className="agent-card">
                        <PeriodicityCard
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
                    </div>
                    <div className="agent-card">
                        <PeriodicityCard eyebrow="git" title="变更">
                            <PeriodicityTerminal title="Git 状态" lines={[workspace?.gitStatus || "工作区暂无变更"]} editable={false} maxHeight={240} wrap />
                        </PeriodicityCard>
                    </div>
                    <div className="agent-card">
                        <PeriodicityCard eyebrow="self" title="我能做什么">
                            <div className="agent-tools">
                                {TOOL_LABELS.map((tool: string) => {
                                    return (
                                        <PeriodicityTag key={tool} tone="neutral" variant="outlined">{tool}</PeriodicityTag>
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
                </div>

                <div className="agent-column agent-column--chat">
                    <div className="agent-card workflow-chat-panel">
                        <PeriodicityCard
                            eyebrow="conversation"
                            title="与模型协作"
                            action={<PeriodicityTag tone={running ? "primary" : "neutral"} variant="outlined">{running ? "运行中" : "就绪"}</PeriodicityTag>}
                        >
                            <div className="agent-messages">
                                <PeriodicityMessageList
                                    currentUser="我"
                                    messages={messages.map((message: AgentMessage) => {
                                        return {
                                            id: message.id,
                                            author: message.role === "user" ? "我" : "模型",
                                            self: message.role === "user",
                                            timestamp: message.time,
                                            content: <PeriodicityMarkdown source={message.content} />,
                                        };
                                    })}
                                />
                                {running && (
                                    <div className="agent-thinking" role="status">
                                        <PeriodicityRing size="sm" />
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
                </div>

                <div className="agent-column">
                    <div className="agent-card">
                        <PeriodicityCard
                            eyebrow="trace"
                            title="运行轨迹"
                            action={<PeriodicityTag tone="neutral" variant="outlined">{toolEvents.length} 事件</PeriodicityTag>}
                        >
                            {toolEvents.length === 0 ? (
                                <PeriodicityEmptyState icon="Play" title="暂无运行轨迹" description="运行任务后，这里会显示每次工具调用与结果。" />
                            ) : (
                                <div className="agent-trace">
                                    <PeriodicityTimeline items={toolEvents.map((event, index: number) => {
                                        return {
                                            id: `${event.type}-${String(index)}`,
                                            title: eventTitle(event),
                                            icon: eventIcon(event),
                                            tone: event.type === "error" || (event.type === "tool_result" && !event.ok) ? "danger" as const : "neutral" as const,
                                            time: event.type === "tool_result" ? `${String(event.durationMs)}ms` : (void 0),
                                            description: event.type === "tool_call"
                                                ? <pre>{event.arguments}</pre>
                                                : event.type === "tool_result"
                                                    ? <PeriodicityTerminal title="工具输出" editable={false} wrap maxHeight={240} lines={[event.output.slice(0, 2500)]} />
                                                    : event.type === "error" ? event.message : "",
                                        };
                                    })} />
                                </div>
                            )}
                        </PeriodicityCard>
                    </div>
                    <div className="agent-card">
                        <PeriodicityCard eyebrow="limits" title="边界">
                            <p className="agent-note">
                                文件和 git 操作限制在工作目录；PowerShell 允许试错，但不会自动把密钥写进文件。
                                每次修改后请让模型跑 lint / build。
                            </p>
                        </PeriodicityCard>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default WorkflowPage;
