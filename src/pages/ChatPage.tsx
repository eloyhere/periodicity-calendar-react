import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import {
    PeriodicityAgentChat,
    PeriodicityButton,
    PeriodicitySkeleton,
    PeriodicityTag,
    PeriodicityToolbar,
} from "periodicity-react";
import type { AgentChatProps, AgentMessageItem, AgentProfile, AgentSession } from "periodicity-react";
import type { LlmChatMessage, LlmChatResult, LlmPublicSettings } from "../../electron/llm/types";
import type { DialogResult, SnackbarResult } from "../../electron/service/types";
import { openDialog, showSnackbar, showSystemNotification } from "../notifications";
import "./ChatPage.css";

const currentUser: string = "我";
const modelAgentName: string = "大模型";
const defaultSessionId: string = "model";
const initialMessages: readonly AgentMessageItem[] = [
    {
        id: "welcome",
        sessionId: defaultSessionId,
        author: modelAgentName,
        content: "你好。我是当前配置的模型。你可以在设置里填写 Base URL、模型名和 API Key，然后直接开始聊天。",
        timestamp: "现在",
        role: "agent",
    },
];

function formatMessageTime(): string {
    return new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function ChatPage() {
    const navigate: ReturnType<typeof useNavigate> = useNavigate();
    const [messages, setMessages]: [AgentMessageItem[], Dispatch<SetStateAction<AgentMessageItem[]>>] = useState<AgentMessageItem[]>([...initialMessages]);
    const [activeSessionId, setActiveSessionId]: [string, Dispatch<SetStateAction<string>>] = useState<string>(defaultSessionId);
    const [settings, setSettings]: [LlmPublicSettings | null, Dispatch<SetStateAction<LlmPublicSettings | null>>] = useState<LlmPublicSettings | null>(null);
    const [isReplying, setIsReplying]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
    const [loading, setLoading]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(true);

    const notifyError: (message: string) => void = useCallback((message: string): void => {
        void showSnackbar({
            message,
            tone: "danger",
            actionLabel: "打开设置",
            duration: 9000,
        }).then((result) => {
            if (result?.reason === "action") {
                navigate("/settings");
            }
        });
    }, [navigate]);

    useEffect(() => {
        let cancelled: boolean = false;
        const load: () => Promise<void> = async () => {
            try {
                const current: LlmPublicSettings = await window.llm.getSettings();
                if (!cancelled) {
                    setSettings(current);
                }
            } catch (loadError: unknown) {
                if (!cancelled) {
                    notifyError(loadError instanceof Error ? loadError.message : "读取模型设置失败");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [notifyError]);

    const activeMessages: AgentMessageItem[] = useMemo(() => {
        return messages.filter((message: AgentMessageItem): boolean => {
            return message.sessionId === activeSessionId;
        });
    }, [activeSessionId, messages]);
    const sessions: readonly AgentSession[] = useMemo(() => {
        const lastMessage: AgentMessageItem | undefined = activeMessages[activeMessages.length - 1];
        const preview: string | undefined = lastMessage?.content.replace(/\s+/g, " ").slice(0, 96);
        return [
            {
                id: defaultSessionId,
                title: modelAgentName,
                preview,
                timestamp: lastMessage?.timestamp,
            },
        ];
    }, [activeMessages]);
    const agent: AgentProfile = useMemo(() => {
        return {
            name: modelAgentName,
            model: settings?.model ?? "未配置模型",
            description: settings?.baseUrl ?? "OpenAI-compatible 模型",
            presence: "online",
        };
    }, [settings]);

    const handleSend: NonNullable<AgentChatProps["onSend"]> = (body, contact) => {
        if (isReplying) {
            return;
        }
        const content: string = body.trim();
        if (content.length === 0) {
            return;
        }
        const userMessage: AgentMessageItem = {
            id: crypto.randomUUID(),
            sessionId: contact.id,
            author: currentUser,
            content,
            timestamp: formatMessageTime(),
            self: true,
            role: "user",
            status: "sent",
        };
        const history: LlmChatMessage[] = [
            ...messages.filter((message: AgentMessageItem): boolean => {
                return message.sessionId === contact.id;
            }),
            userMessage,
        ].map((message: AgentMessageItem): LlmChatMessage => {
            return {
                role: message.role === "user" ? "user" : "assistant",
                content: message.content,
            };
        });
        setMessages((current: AgentMessageItem[]): AgentMessageItem[] => {
            return [...current, userMessage];
        });
        setIsReplying(true);
        const send: () => Promise<void> = async () => {
            try {
                const result: LlmChatResult = await window.llm.chat({ messages: history });
                if (!result.ok) {
                    notifyError(result.error ?? "模型请求失败");
                    return;
                }
                const assistantMessage: AgentMessageItem = {
                    id: crypto.randomUUID(),
                    sessionId: contact.id,
                    author: modelAgentName,
                    content: result.content.length > 0 ? result.content : "（模型返回了空内容）",
                    timestamp: formatMessageTime(),
                    role: "agent",
                };
                setMessages((current: AgentMessageItem[]): AgentMessageItem[] => {
                    return [...current, assistantMessage];
                });
                void showSystemNotification({
                    title: "模型回复完成",
                    body: result.content.length > 0 ? result.content.slice(0, 160) : "模型已返回结果",
                    whenUnfocused: true,
                });
            } catch (sendError: unknown) {
                notifyError(sendError instanceof Error ? sendError.message : "模型请求失败");
            } finally {
                setIsReplying(false);
            }
        };
        void send();
    };

    const handleClear: () => Promise<void> = async () => {
        if (isReplying) {
            return;
        }
        const result: DialogResult | null = await openDialog({
            title: "清空对话？",
            eyebrow: "CHAT RESET",
            description: "这会移除当前会话中的所有消息；模型设置不会受影响。",
            tone: "danger",
            confirmLabel: "清空",
            cancelLabel: "取消",
        });
        if (result?.action !== "confirm") {
            return;
        }
        const previous: AgentMessageItem[] = messages;
        const retainedMessages: AgentMessageItem[] = messages.filter((message: AgentMessageItem): boolean => {
            return message.sessionId !== activeSessionId;
        });
        const resetMessages: AgentMessageItem[] = initialMessages.map((message: AgentMessageItem): AgentMessageItem => {
            return { ...message, sessionId: activeSessionId };
        });
        setMessages([...retainedMessages, ...resetMessages]);
        const snackbar: SnackbarResult | null = await showSnackbar({
            message: "对话已清空。",
            actionLabel: "撤销",
            duration: 8000,
        });
        if (snackbar?.reason === "action") {
            setMessages(previous);
        }
    };

    if (loading) {
        return (
            <section className="chat-page" aria-busy="true">
                <div className="chat-loading">
                    <PeriodicitySkeleton variant="rect" height={48} />
                    <PeriodicitySkeleton variant="rect" height={420} />
                </div>
            </section>
        );
    }

    return (
        <section className="chat-page">
            <div className="chat-page__bar">
                <PeriodicityToolbar
                    title={settings?.model ?? "未配置模型"}
                    subtitle={settings?.baseUrl ?? "请配置 API Base URL"}
                    actions={
                        <div className="chat-page__bar-actions">
                            <PeriodicityTag tone={settings?.hasKey ? "success" : "warning"} variant="outlined">
                                {settings?.hasKey ? "API Key 已配置" : "缺少 API Key"}
                            </PeriodicityTag>
                            <PeriodicityButton
                                variant="ghost"
                                disabled={isReplying || activeMessages.length <= 1}
                                onClick={() => {
                                    void handleClear();
                                }}
                            >
                                清空对话
                            </PeriodicityButton>
                        </div>
                    }
                />
            </div>
            <div className="chat-page__conversation">
                <PeriodicityAgentChat
                    agent={agent}
                    sessions={sessions}
                    messages={messages}
                    value={activeSessionId}
                    onValueChange={(value: string) => {
                        setActiveSessionId(value);
                    }}
                    onSend={handleSend}
                    sending={isReplying}
                    currentUser={currentUser}
                    historyTitle="会话"
                    historyLabel="会话"
                    placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                    sendLabel="发送消息"
                />
            </div>
        </section>
    );
}

export default ChatPage;
