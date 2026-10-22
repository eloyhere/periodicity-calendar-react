import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
    PeriodicityButton,
    PeriodicityIcon,
    PeriodicityTag,
} from "periodicity-react";
import type { PeriodicityIconName } from "periodicity-react";
import type {
    SystemNotificationHistoryItem,
} from "../../../electron/service/types";
import "./NotificationWindow.css";

type NotificationStatusTone = "success" | "warning" | "danger";

interface NotificationStatus {
    label: string;
    tone: NotificationStatusTone;
    icon: PeriodicityIconName;
}

/**
 * Formats one ISO timestamp for the notification center.
 * @param value ISO timestamp.
 * @return Localized date and time.
 */
function formatTime(value: string): string {
    return new Date(value).toLocaleString("zh-CN", {
        hour12: false,
    });
}

/**
 * Derives the display status of one history record.
 * @param record Notification history record.
 * @return Label, tone, and icon for the record status.
 */
function statusOf(record: SystemNotificationHistoryItem): NotificationStatus {
    if (record.shown) {
        return {
            label: "已发送",
            tone: "success",
            icon: "Success",
        };
    }
    if (!record.supported) {
        return {
            label: "系统不支持",
            tone: "danger",
            icon: "Error",
        };
    }
    return {
        label: "已跳过",
        tone: "warning",
        icon: "Warning",
    };
}

function NotificationWindow() {
    const [records, setRecords]: [SystemNotificationHistoryItem[], Dispatch<SetStateAction<SystemNotificationHistoryItem[]>>] = useState<SystemNotificationHistoryItem[]>([]);

    useEffect(() => {
        const unsubscribe: () => void = window.notification.onHistory((items: SystemNotificationHistoryItem[]) => {
            setRecords(items);
        });
        window.notification.centerReady();
        return unsubscribe;
    }, []);

    return (
        <div className="notification-center">
            <header className="notification-center__header">
                <div className="notification-center__identity">
                    <span className="notification-center__mark" aria-hidden="true">
                        <PeriodicityIcon name="Bell" size={18} />
                    </span>
                    <div>
                        <strong>通知中心</strong>
                        <span>独立 Notification 进程</span>
                    </div>
                </div>
                <div className="notification-center__header-actions">
                    <PeriodicityTag tone={records.length > 0 ? "primary" : "neutral"} variant="outlined">
                        {records.length} 条记录
                    </PeriodicityTag>
                    <PeriodicityButton
                        variant="quiet"
                        size="sm"
                        icon="Close"
                        aria-label="关闭通知中心"
                        title="关闭"
                        onClick={() => {
                            window.windowControls.close();
                        }}
                    />
                </div>
            </header>

            <div className="notification-center__body">
                {records.length === 0 ? (
                    <div className="notification-center__empty">
                        <PeriodicityIcon name="Bell" size={42} />
                        <h2>还没有系统通知</h2>
                        <p>在 CallTest 页面发送一条系统通知后，这里会保留最近 50 条发送记录。</p>
                    </div>
                ) : (
                    <ol className="notification-center__list">
                        {records.map((record: SystemNotificationHistoryItem) => {
                            const status: NotificationStatus = statusOf(record);
                            return (
                                <li className="notification-center__item" key={record.id}>
                                    <div className="notification-center__item-head">
                                        <span className="notification-center__item-icon" aria-hidden="true">
                                            <PeriodicityIcon name={status.icon} size={16} />
                                        </span>
                                        <div className="notification-center__item-title">
                                            <strong>{record.title}</strong>
                                            <time>{formatTime(record.at)}</time>
                                        </div>
                                        <PeriodicityTag tone={status.tone} variant="outlined">
                                            {status.label}
                                        </PeriodicityTag>
                                    </div>
                                    {record.body && <p className="notification-center__body-text">{record.body}</p>}
                                    <div className="notification-center__item-foot">
                                        <code>{record.id}</code>
                                        {record.reason && <span>{record.reason}</span>}
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </div>

            <footer className="notification-center__footer">
                <span>原生通知由主进程创建，通知中心与其历史运行在独立渲染进程。</span>
                <PeriodicityButton
                    variant="ghost"
                    size="sm"
                    disabled={records.length === 0}
                    onClick={() => {
                        window.notification.clearHistory();
                    }}
                >
                    清空记录
                </PeriodicityButton>
            </footer>
        </div>
    );
}

export default NotificationWindow;
