import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { PeriodicityButton, PeriodicityChat, PeriodicitySkeleton } from "periodicity-react";
import type { LlmChatMessage, LlmChatResult, LlmPublicSettings } from "../../electron/llm/types";
import type { DialogResult, SnackbarResult } from "../../electron/service/types";
import LlmSettingsDialog from "../components/LlmSettingsDialog";
import { openDialog, showSnackbar, showSystemNotification, showToast } from "../notifications";
import "./ChatPage.css";

type ChatPresence = "online" | "away" | "busy" | "offline";
type ChatStatus = "sending" | "sent" | "read" | "failed";

interface ChatContact {
    id: string;
    name: string;
    description?: string;
    presence?: ChatPresence;
}

interface ChatMessage {
    id: string;
    contactId: string;
    author: string;
    content: string;
    timestamp?: string;
    self?: boolean;
    status?: ChatStatus;
}

const currentUser: string = "我";
const modelContact: ChatContact = {
    id: "model",
    name: "大模型",
    description: "当前配置的 OpenAI-compatible 模型",
    presence: "online",
};
const initialMessages: readonly ChatMessage[] = [
    {
        id: "welcome",
        contactId: "model",
        author: "大模型",
        content: "你好。我是当前配置的模型。你可以在设置里填写 Base URL、模型名和 API Key，然后直接开始聊天。",
        timestamp: "现在",
    },
];

function ChatPage() {
    const [messages, setMessages]: [ChatMessage[], Dispatch<SetStateAction<ChatMessage[]>>] = useState<ChatMessage[]>([...initialMessages]);
    const [settings, setSettings]: [LlmPublicSettings | null, Dispatch<SetStateAction<LlmPublicSettings | null>>] = useState<LlmPublicSettings | null>(null);
    const [settingsOpen, setSettingsOpen]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
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
                setSettingsOpen(true);
            }
        });
    }, []);

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

    const handleSend: (body: string, contact: ChatContact) => void = (body, contact) => {
        if (isReplying) {
            return;
        }
        const content: string = body.trim();
        if (content.length === 0) {
            return;
        }
        const userMessage: ChatMessage = {
            id: crypto.randomUUID(),
            contactId: contact.id,
            author: currentUser,
            content,
            timestamp: new Date().toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
            }),
            self: true,
            status: "sent",
        };
        const history: LlmChatMessage[] = [...messages, userMessage].map((message: ChatMessage): LlmChatMessage => {
            return {
                role: message.self ? "user" : "assistant",
                content: message.content,
            };
        });
        setMessages((current) => {
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
                const assistantMessage: ChatMessage = {
                    id: crypto.randomUUID(),
                    contactId: contact.id,
                    author: "大模型",
                    content: result.content.length > 0 ? result.content : "（模型返回了空内容）",
                    timestamp: new Date().toLocaleTimeString("zh-CN", {
                        hour: "2-digit",
                        minute: "2-digit",
                    }),
                };
                setMessages((current) => {
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
        const previous: ChatMessage[] = messages;
        setMessages([...initialMessages]);
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
                <div className="chat-page__identity">
                    <strong>{settings?.model ?? "未配置模型"}</strong>
                    <span>{settings?.baseUrl ?? "请配置 API Base URL"}</span>
                    <span className={settings?.hasKey ? "chat-page__key chat-page__key--ok" : "chat-page__key"}>
                        {settings?.hasKey ? "API Key 已配置" : "缺少 API Key"}
                    </span>
                </div>
                <div className="chat-page__bar-actions">
                    <PeriodicityButton
                        variant="ghost"
                        disabled={isReplying || messages.length <= 1}
                        onClick={() => {
                            void handleClear();
                        }}
                    >
                        清空对话
                    </PeriodicityButton>
                    <PeriodicityButton variant="outline" icon="Sync" onClick={() => { setSettingsOpen(true); }}>
                        模型设置
                    </PeriodicityButton>
                </div>
            </div>
            {isReplying && <p className="chat-page__status">模型正在生成回复…</p>}
            <PeriodicityChat
                className="chat-page__chat"
                contacts={[modelContact]}
                messages={messages}
                value={modelContact.id}
                onValueChange={() => {
                    // Single-model conversation.
                }}
                onSend={handleSend}
                currentUser={currentUser}
                contactsTitle="会话"
                contactsLabel="模型"
                conversationLabel="对话"
                placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                sendLabel="发送消息"
            />
            <LlmSettingsDialog
                open={settingsOpen}
                onClose={() => {
                    setSettingsOpen(false);
                }}
                onSaved={(next: LlmPublicSettings) => {
                    setSettings(next);
                    showToast({
                        title: "模型设置已保存",
                        description: next.model,
                        tone: "success",
                    });
                }}
            />
        </section>
    );
}

export default ChatPage;
