import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
    PeriodicityButton,
    PeriodicityCard,
    PeriodicityCheckbox,
    PeriodicityTag,
    PeriodicityTextArea,
    PeriodicityTextInput,
} from "periodicity-react";
import type {
    DialogResult,
    NotificationPlatformInfo,
    SnackbarResult,
    SystemNotificationEvent,
    SystemNotificationResult,
    SystemNotificationTimeout,
    SystemNotificationUrgency,
    ToastResult,
} from "../../electron/service/types";
import "./CallTestPage.css";

type LogTone = "neutral" | "success" | "warning" | "danger";

interface CallTestLogEntry {
    id: string;
    at: string;
    title: string;
    detail?: string;
    tone: LogTone;
}

/**
 * Returns a short human-readable title for one native notification event.
 * @param event Native notification event.
 * @return Chinese event label.
 */
function eventTitle(event: SystemNotificationEvent): string {
    if (event.type === "show") {
        return "系统通知已显示";
    }
    if (event.type === "click") {
        return "系统通知被点击";
    }
    if (event.type === "close") {
        return "系统通知已关闭";
    }
    if (event.type === "failed") {
        return "系统通知失败";
    }
    return "系统通知操作";
}

/**
 * Returns the detail line for one native notification event.
 * @param event Native notification event.
 * @return Event identifier and optional failure/action detail.
 */
function eventDetail(event: SystemNotificationEvent): string {
    if (event.type === "failed") {
        return event.error ?? "系统通知失败";
    }
    if (event.type === "action") {
        return `action ${String(event.actionIndex ?? 0)} · ${event.id}`;
    }
    return event.id;
}

/**
 * Maps a native notification event to the test log tone.
 * @param event Native notification event.
 * @return Visual tone for the log row.
 */
function eventTone(event: SystemNotificationEvent): LogTone {
    if (event.type === "failed") {
        return "danger";
    }
    if (event.type === "show" || event.type === "click") {
        return "success";
    }
    return "neutral";
}

function CallTestPage() {
    const [title, setTitle]: [string, Dispatch<SetStateAction<string>>] = useState<string>("Periodicity Calendar");
    const [body, setBody]: [string, Dispatch<SetStateAction<string>>] = useState<string>("这是一条来自 Notification 进程的测试通知。");
    const [silent, setSilent]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
    const [whenUnfocused, setWhenUnfocused]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
    const [urgency, setUrgency]: [SystemNotificationUrgency, Dispatch<SetStateAction<SystemNotificationUrgency>>] = useState<SystemNotificationUrgency>("normal");
    const [timeoutType, setTimeoutType]: [SystemNotificationTimeout, Dispatch<SetStateAction<SystemNotificationTimeout>>] = useState<SystemNotificationTimeout>("default");
    const [supported, setSupported]: [boolean | null, Dispatch<SetStateAction<boolean | null>>] = useState<boolean | null>(null);
    const [platformInfo, setPlatformInfo]: [NotificationPlatformInfo | null, Dispatch<SetStateAction<NotificationPlatformInfo | null>>] = useState<NotificationPlatformInfo | null>(null);
    const [sending, setSending]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
    const [lastResult, setLastResult]: [SystemNotificationResult | null, Dispatch<SetStateAction<SystemNotificationResult | null>>] = useState<SystemNotificationResult | null>(null);
    const [lastId, setLastId]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
    const [events, setEvents]: [CallTestLogEntry[], Dispatch<SetStateAction<CallTestLogEntry[]>>] = useState<CallTestLogEntry[]>([]);
    const delayTimer: RefObject<number | null> = useRef<number | null>(null);

    const appendLog: (headline: string, detail?: string, tone?: LogTone) => void = useCallback((headline: string, detail: string = "", tone: LogTone = "neutral"): void => {
        const entry: CallTestLogEntry = {
            id: crypto.randomUUID(),
            at: new Date().toLocaleTimeString("zh-CN", {
                hour12: false,
            }),
            title: headline,
            detail: detail.length > 0 ? detail : (void 0),
            tone,
        };
        setEvents((current: CallTestLogEntry[]) => {
            return [entry, ...current].slice(0, 40);
        });
    }, []);

    const checkSupport: () => Promise<void> = useCallback(async (): Promise<void> => {
        try {
            const info: NotificationPlatformInfo = await window.notification.platformInfo();
            setPlatformInfo(info);
            setSupported(info.supported);
            appendLog(
                "系统通知支持检查",
                `${info.label} ${info.version} · ${info.notes.join(" ")}`,
                info.supported ? "success" : "danger",
            );
        } catch (error: unknown) {
            setSupported(false);
            appendLog(
                "系统通知支持检查失败",
                error instanceof Error ? error.message : "无法调用 Notification 进程。",
                "danger",
            );
        }
    }, [appendLog]);

    useEffect(() => {
        void checkSupport();
        const unsubscribe: () => void = window.notification.onEvent((event: SystemNotificationEvent) => {
            appendLog(eventTitle(event), eventDetail(event), eventTone(event));
        });
        return (): void => {
            if (delayTimer.current !== null) {
                window.clearTimeout(delayTimer.current);
                delayTimer.current = null;
            }
            unsubscribe();
        };
    }, [appendLog, checkSupport]);

    const handleSend: () => Promise<void> = async (): Promise<void> => {
        const trimmedTitle: string = title.trim();
        if (trimmedTitle.length === 0) {
            appendLog("发送取消", "系统通知标题不能为空。", "warning");
            return;
        }
        setSending(true);
        try {
            const result: SystemNotificationResult = await window.notification.show({
                title: trimmedTitle,
                body: body.trim(),
                silent,
                urgency,
                timeoutType,
                whenUnfocused,
            });
            setLastResult(result);
            setLastId(result.shown ? result.id : "");
            appendLog(
                result.shown ? "系统通知已发送" : "系统通知已跳过",
                result.reason ?? result.id,
                result.shown ? "success" : "warning",
            );
        } catch (error: unknown) {
            appendLog(
                "发送系统通知失败",
                error instanceof Error ? error.message : "Notification 进程调用失败。",
                "danger",
            );
        } finally {
            setSending(false);
        }
    };

    const handleDelayedSend: () => void = (): void => {
        if (delayTimer.current !== null) {
            window.clearTimeout(delayTimer.current);
        }
        appendLog("已安排延迟发送", "5 秒后触发；现在切换离开应用即可测试“仅应用不在前台时发送”。", "neutral");
        delayTimer.current = window.setTimeout(() => {
            delayTimer.current = null;
            void handleSend();
        }, 5000);
    };

    const handleCloseLast: () => void = (): void => {
        if (lastId.length === 0) {
            return;
        }
        window.notification.close(lastId);
        appendLog("已请求关闭最近通知", lastId, "neutral");
        setLastId("");
    };

    const handleSnackbar: () => Promise<void> = async (): Promise<void> => {
        try {
            const result: SnackbarResult = await window.snackbar.show({
                message: "这是一条来自 Snackbar 进程的测试消息。",
                tone: "success",
                actionLabel: "知道了",
                duration: 6000,
            });
            appendLog("Snackbar 已关闭", `reason=${result.reason}`, "success");
        } catch (error: unknown) {
            appendLog("Snackbar 调用失败", error instanceof Error ? error.message : "未知错误", "danger");
        }
    };

    const handleToast: () => Promise<void> = async (): Promise<void> => {
        try {
            const result: ToastResult = await window.toast.show({
                title: "Toast 测试",
                description: "来自 Toast 独立窗口，4 秒后自动关闭。",
                tone: "success",
                duration: 4000,
            });
            appendLog("Toast 已关闭", `reason=${result.reason}`, "success");
        } catch (error: unknown) {
            appendLog("Toast 调用失败", error instanceof Error ? error.message : "未知错误", "danger");
        }
    };

    const handleDialog: () => Promise<void> = async (): Promise<void> => {
        try {
            const result: DialogResult = await window.dialog.open({
                title: "Dialog 测试",
                eyebrow: "CALL TEST",
                description: "这是由独立 Dialog 进程渲染的模态弹窗。",
                message: "点击确认或取消后，测试台会记录这次调用。",
                confirmLabel: "确认",
                cancelLabel: "取消",
            });
            appendLog(
                "Dialog 已关闭",
                `action=${result.action}`,
                result.action === "confirm" ? "success" : "neutral",
            );
        } catch (error: unknown) {
            appendLog("Dialog 调用失败", error instanceof Error ? error.message : "未知错误", "danger");
        }
    };

    let resultText: string = "尚未发送系统通知。";
    if (lastResult) {
        resultText = lastResult.shown
            ? `已发送系统通知 · ${lastResult.id}`
            : `未发送 · ${lastResult.reason ?? "未知原因"}`;
    }

    return (
        <section className="calltest-page">
            <p className="calltest-intro">
                这个页面直接调用主进程的 Notification 服务。应用在前台时，如果不勾选“仅应用不在前台时发送”，系统通知会立即弹出。
            </p>
            {platformInfo && (
                <p className="calltest-platform">
                    <strong>{platformInfo.label}</strong>
                    <span>{platformInfo.version}</span>
                    {platformInfo.requiresCodeSigning && <span>需要代码签名</span>}
                    {platformInfo.requiresShortcut && <span>需要开始菜单快捷方式</span>}
                </p>
            )}
            <div className="calltest-grid">
                <PeriodicityCard
                    className="calltest-card"
                    eyebrow="SYSTEM NOTIFICATION"
                    title="系统通知"
                    action={
                        <PeriodicityTag
                            tone={supported === false ? "danger" : supported === true ? "success" : "neutral"}
                            variant="outlined"
                        >
                            {supported === null ? "检测中" : supported ? "系统支持" : "系统不支持"}
                        </PeriodicityTag>
                    }
                >
                    <div className="calltest-form">
                        <PeriodicityTextInput
                            label="标题"
                            value={title}
                            maxLength={120}
                            onChange={(event) => {
                                setTitle(event.target.value);
                            }}
                        />
                        <PeriodicityTextArea
                            label="正文"
                            value={body}
                            rows={4}
                            maxLength={600}
                            showCount
                            onChange={(event) => {
                                setBody(event.target.value);
                            }}
                        />
                        <div className="calltest-row">
                            <label className="calltest-field">
                                <span>紧急程度</span>
                                <select
                                    value={urgency}
                                    onChange={(event) => {
                                        setUrgency(event.target.value as SystemNotificationUrgency);
                                    }}
                                >
                                    <option value="normal">normal · 普通</option>
                                    <option value="critical">critical · 紧急</option>
                                    <option value="low">low · 低</option>
                                </select>
                            </label>
                            <label className="calltest-field">
                                <span>超时行为</span>
                                <select
                                    value={timeoutType}
                                    onChange={(event) => {
                                        setTimeoutType(event.target.value as SystemNotificationTimeout);
                                    }}
                                >
                                    <option value="default">default · 跟随系统</option>
                                    <option value="never">never · 常驻</option>
                                </select>
                            </label>
                        </div>
                        <div className="calltest-checks">
                            <PeriodicityCheckbox
                                label="静默通知"
                                description="不播放系统提示音。"
                                checked={silent}
                                onCheckedChange={(checked: boolean) => {
                                    setSilent(checked);
                                }}
                            />
                            <PeriodicityCheckbox
                                label="仅应用不在前台时发送"
                                description="应用窗口聚焦时直接跳过，避免与 Toast 重复。"
                                checked={whenUnfocused}
                                onCheckedChange={(checked: boolean) => {
                                    setWhenUnfocused(checked);
                                }}
                            />
                        </div>
                        <div className="calltest-actions">
                            <PeriodicityButton
                                icon="Send"
                                onClick={() => {
                                    void handleSend();
                                }}
                                disabled={sending || supported === false}
                            >
                                {sending ? "发送中…" : "发送系统通知"}
                            </PeriodicityButton>
                            <PeriodicityButton
                                variant="outline"
                                icon="Play"
                                onClick={handleDelayedSend}
                                disabled={supported === false}
                            >
                                5 秒后发送
                            </PeriodicityButton>
                            <PeriodicityButton
                                variant="outline"
                                icon="Bell"
                                onClick={() => {
                                    window.notification.openCenter();
                                    appendLog("已打开通知中心", "独立 Notification 窗口", "neutral");
                                }}
                            >
                                通知中心
                            </PeriodicityButton>
                            <PeriodicityButton
                                variant="outline"
                                icon="Refresh"
                                onClick={() => {
                                    void checkSupport();
                                }}
                            >
                                检查支持
                            </PeriodicityButton>
                            <PeriodicityButton
                                variant="outline"
                                onClick={() => {
                                    void window.notification.openSettings().then(() => {
                                        appendLog("已打开系统通知设置", "请确认通知总开关和应用通知权限已开启。", "neutral");
                                    }).catch((error: unknown) => {
                                        appendLog(
                                            "打开系统通知设置失败",
                                            error instanceof Error ? error.message : "系统设置不可用。",
                                            "danger",
                                        );
                                    });
                                }}
                            >
                                系统通知设置
                            </PeriodicityButton>
                            <PeriodicityButton
                                variant="ghost"
                                icon="Close"
                                onClick={handleCloseLast}
                                disabled={lastId.length === 0}
                            >
                                关闭最近一条
                            </PeriodicityButton>
                        </div>
                        <p className={lastResult && !lastResult.shown ? "calltest-result calltest-result--warning" : "calltest-result"}>
                            {resultText}
                        </p>
                    </div>
                </PeriodicityCard>

                <div className="calltest-column">
                    <PeriodicityCard
                        className="calltest-card"
                        eyebrow="IN-APP SURFACES"
                        title="应用内弹窗"
                        action={<PeriodicityTag tone="neutral" variant="outlined">独立窗口</PeriodicityTag>}
                    >
                        <p className="calltest-note">
                            Snackbar、Toast、Dialog 都有独立的渲染进程和窗口；这里可以直接触发并观察关闭原因。
                        </p>
                        <div className="calltest-actions">
                            <PeriodicityButton
                                variant="outline"
                                icon="Message"
                                onClick={() => {
                                    void handleSnackbar();
                                }}
                            >
                                Snackbar
                            </PeriodicityButton>
                            <PeriodicityButton
                                variant="outline"
                                icon="Info"
                                onClick={() => {
                                    void handleToast();
                                }}
                            >
                                Toast
                            </PeriodicityButton>
                            <PeriodicityButton
                                variant="outline"
                                icon="Chat"
                                onClick={() => {
                                    void handleDialog();
                                }}
                            >
                                Dialog
                            </PeriodicityButton>
                        </div>
                    </PeriodicityCard>

                    <PeriodicityCard
                        className="calltest-card"
                        eyebrow="EVENT LOG"
                        title="事件日志"
                        action={
                            <PeriodicityButton
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setEvents([]);
                                }}
                            >
                                清空
                            </PeriodicityButton>
                        }
                    >
                        {events.length === 0 ? (
                            <p className="calltest-log__empty">发送通知后，这里会显示调用结果和系统事件。</p>
                        ) : (
                            <ul className="calltest-log">
                                {events.map((entry: CallTestLogEntry) => {
                                    return (
                                        <li className="calltest-log__item" key={entry.id}>
                                            <span className={`calltest-log__dot calltest-log__dot--${entry.tone}`} aria-hidden="true" />
                                            <span className="calltest-log__body">
                                                <strong>{entry.title}</strong>
                                                {entry.detail && <span>{entry.detail}</span>}
                                            </span>
                                            <time className="calltest-log__time">{entry.at}</time>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </PeriodicityCard>
                </div>
            </div>
        </section>
    );
}

export default CallTestPage;
