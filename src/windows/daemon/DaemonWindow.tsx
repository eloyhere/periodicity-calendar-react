import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
    PeriodicityButton,
    PeriodicityIcon,
    PeriodicityTag,
} from "periodicity-react";
import type { PeriodicityIconName } from "periodicity-react";
import type {
    DaemonAction,
    DaemonErrorKind,
    DaemonErrorRecord,
    DaemonSnapshot,
} from "../../../electron/service/types";
import "./DaemonWindow.css";

const KIND_LABELS: Record<DaemonErrorKind, string> = {
    "main-exception": "主进程异常",
    "main-rejection": "未处理 Promise",
    "renderer-error": "渲染错误",
    "renderer-gone": "渲染进程退出",
    "preload-error": "Preload 错误",
    "load-failure": "页面加载失败",
    "child-process-gone": "子进程退出",
    "unresponsive": "页面无响应",
};

const KIND_ICONS: Record<DaemonErrorKind, PeriodicityIconName> = {
    "main-exception": "Error",
    "main-rejection": "Warning",
    "renderer-error": "Bug",
    "renderer-gone": "Error",
    "preload-error": "Bug",
    "load-failure": "Warning",
    "child-process-gone": "Warning",
    "unresponsive": "Loading",
};

/**
 * Formats one ISO timestamp for the guardian detail pane.
 * @param value ISO timestamp.
 * @return Localized date and time.
 */
function formatTime(value: string): string {
    return new Date(value).toLocaleString("zh-CN", {
        hour12: false,
    });
}

function DaemonWindow() {
    const [snapshot, setSnapshot]: [DaemonSnapshot | null, Dispatch<SetStateAction<DaemonSnapshot | null>>] = useState<DaemonSnapshot | null>(null);
    const [selectedId, setSelectedId]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe: () => void = window.daemon.onSnapshot((next: DaemonSnapshot) => {
            setSnapshot(next);
            setSelectedId((current: string | null) => {
                if (current !== null && next.errors.some((error: DaemonErrorRecord): boolean => {
                    return error.id === current;
                })) {
                    return current;
                }
                return next.errors[0]?.id ?? null;
            });
        });
        window.daemon.ready();
        return unsubscribe;
    }, []);

    const selected: DaemonErrorRecord | null = snapshot?.errors.find((error: DaemonErrorRecord): boolean => {
        return error.id === selectedId;
    }) ?? snapshot?.errors[0] ?? null;

    const handleAction: (action: DaemonAction) => void = useCallback((action: DaemonAction): void => {
        void window.daemon.action(action, selectedId ?? (void 0)).catch(() => {
            // The guardian window is going away if this call fails.
        });
    }, [selectedId]);

    return (
        <div className="daemon-window">
            <header className="daemon-window__header">
                <div className="daemon-window__identity">
                    <span className="daemon-window__pulse" aria-hidden="true" />
                    <div>
                        <strong>守护进程</strong>
                        <span>程序错误处理 · v{snapshot?.appVersion ?? "0.0.0"} · Electron {snapshot?.electronVersion ?? "—"}</span>
                    </div>
                </div>
                <div className="daemon-window__header-actions">
                    <PeriodicityTag
                        tone={snapshot && snapshot.total > 0 ? "danger" : "success"}
                        variant="outlined"
                    >
                        {snapshot && snapshot.total > 0 ? `${String(snapshot.total)} 个错误` : "运行中"}
                    </PeriodicityTag>
                    {snapshot && !snapshot.mainWindowAlive && (
                        <PeriodicityTag tone="warning" variant="outlined">主窗口已关闭</PeriodicityTag>
                    )}
                    <PeriodicityButton
                        variant="quiet"
                        size="sm"
                        icon="Close"
                        aria-label="关闭守护窗口"
                        title="关闭"
                        onClick={() => {
                            handleAction("dismiss");
                        }}
                    />
                </div>
            </header>

            <div className="daemon-window__body">
                <aside className="daemon-window__list" aria-label="错误列表">
                    {snapshot && snapshot.errors.length > 0 ? (
                        snapshot.errors.map((error: DaemonErrorRecord) => {
                            return (
                                <button
                                    type="button"
                                    key={error.id}
                                    className={`daemon-window__item${selected?.id === error.id ? " daemon-window__item--active" : ""}`}
                                    aria-pressed={selected?.id === error.id}
                                    onClick={() => {
                                        setSelectedId(error.id);
                                    }}
                                >
                                    <PeriodicityIcon name={KIND_ICONS[error.kind]} size={16} />
                                    <span className="daemon-window__item-body">
                                        <strong>{error.message}</strong>
                                        <span>
                                            {KIND_LABELS[error.kind]} · {formatTime(error.at)}
                                            {error.count > 1 ? ` · ×${String(error.count)}` : ""}
                                        </span>
                                    </span>
                                </button>
                            );
                        })
                    ) : (
                        <p className="daemon-window__list-empty">尚未捕获错误。</p>
                    )}
                </aside>

                <section className="daemon-window__detail" aria-live="polite">
                    {selected ? (
                        <>
                            <div className="daemon-window__detail-head">
                                <div className="daemon-window__detail-title">
                                    <span className="daemon-window__eyebrow">{KIND_LABELS[selected.kind]}</span>
                                    <h2>{selected.message}</h2>
                                </div>
                                <PeriodicityTag tone={selected.fatal ? "danger" : "warning"} variant="outlined">
                                    {selected.fatal ? "致命" : "非致命"}
                                </PeriodicityTag>
                            </div>
                            <dl className="daemon-window__meta">
                                <div><dt>时间</dt><dd>{formatTime(selected.at)}</dd></div>
                                <div><dt>来源</dt><dd>{selected.source ?? "unknown"}</dd></div>
                                <div><dt>次数</dt><dd>{selected.count}</dd></div>
                                <div><dt>平台</dt><dd>{snapshot?.platform ?? "unknown"}</dd></div>
                            </dl>
                            {selected.detail && (
                                <p className="daemon-window__note">{selected.detail}</p>
                            )}
                            <pre className="daemon-window__stack">{selected.stack ?? "没有堆栈信息。"}</pre>
                        </>
                    ) : (
                        <div className="daemon-window__empty">
                            <PeriodicityIcon name="Shield" size={42} />
                            <h2>守护进程运行中</h2>
                            <p>主进程、渲染进程、preload、页面加载和未处理 Promise 都会被记录在这里。</p>
                        </div>
                    )}
                </section>
            </div>

            <footer className="daemon-window__footer">
                <code title={snapshot?.logPath ?? "daemon-errors.log"}>{snapshot?.logPath ?? "daemon-errors.log"}</code>
                <div className="daemon-window__footer-actions">
                    <PeriodicityButton
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            handleAction("dismiss");
                        }}
                    >
                        忽略
                    </PeriodicityButton>
                    <PeriodicityButton
                        variant="outline"
                        size="sm"
                        icon="Open"
                        onClick={() => {
                            handleAction("copy");
                        }}
                    >
                        复制详情
                    </PeriodicityButton>
                    <PeriodicityButton
                        variant="outline"
                        size="sm"
                        icon="Refresh"
                        onClick={() => {
                            handleAction("reload");
                        }}
                    >
                        重新加载界面
                    </PeriodicityButton>
                    <PeriodicityButton
                        size="sm"
                        onClick={() => {
                            handleAction("quit");
                        }}
                    >
                        退出应用
                    </PeriodicityButton>
                </div>
            </footer>
        </div>
    );
}

export default DaemonWindow;
