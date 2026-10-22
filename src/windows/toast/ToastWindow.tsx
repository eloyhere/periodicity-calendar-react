import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { PeriodicityButton, PeriodicityIcon } from "periodicity-react";
import type { PeriodicityIconName } from "periodicity-react";
import type {
    ToastDismissReason,
    ToastItem,
    ToastTone,
} from "../../../electron/service/types";
import { useReportHeight } from "../shared/useReportHeight";
import "./ToastWindow.css";

const TONE_ICONS: Record<ToastTone, PeriodicityIconName> = {
    neutral: "Info",
    success: "Success",
    warning: "Warning",
    danger: "Error",
};

function ToastWindow() {
    const [items, setItems]: [ToastItem[], Dispatch<SetStateAction<ToastItem[]>>] = useState<ToastItem[]>([]);
    const timers: RefObject<Map<string, number>> = useRef<Map<string, number>>(new Map<string, number>());

    const dismiss: (id: string, reason: ToastDismissReason) => void = useCallback((id: string, reason: ToastDismissReason): void => {
        window.toast.closed(id, reason);
    }, []);

    useEffect(() => {
        const unsubscribe: () => void = window.toast.onUpdate((next: ToastItem[]) => {
            setItems(next);
        });
        window.toast.ready();
        return unsubscribe;
    }, []);

    useEffect(() => {
        const activeIds: Set<string> = new Set(items.map((item: ToastItem): string => {
            return item.id;
        }));
        for (const entry of timers.current) {
            const id: string = entry[0];
            const timer: number = entry[1];
            if (!activeIds.has(id)) {
                window.clearTimeout(timer);
                timers.current.delete(id);
            }
        }
        for (const item of items) {
            if (timers.current.has(item.id) || item.duration <= 0) {
                continue;
            }
            const timer: number = window.setTimeout(() => {
                timers.current.delete(item.id);
                dismiss(item.id, "timeout");
            }, item.duration);
            timers.current.set(item.id, timer);
        }
    }, [dismiss, items]);

    useEffect(() => {
        const activeTimers: Map<string, number> = timers.current;
        return (): void => {
            for (const timer of activeTimers.values()) {
                window.clearTimeout(timer);
            }
            activeTimers.clear();
        };
    }, []);

    const reportHeight: (height: number) => void = useCallback((height: number): void => {
        window.toast.resize(height);
    }, []);

    useReportHeight(".overlay-toast-region", reportHeight);

    return (
        <div className="overlay-toast-region" role="region" aria-label="通知">
            {items.map((item: ToastItem) => {
                return (
                    <article
                        className={`overlay-toast overlay-toast--${item.tone}`}
                        key={item.id}
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                    >
                        <span className="overlay-toast__stripe" aria-hidden="true" />
                        <span className="overlay-toast__icon" aria-hidden="true">
                            <PeriodicityIcon name={TONE_ICONS[item.tone]} size={16} />
                        </span>
                        <div className="overlay-toast__content">
                            <strong className="overlay-toast__title">{item.title}</strong>
                            {item.description && <span className="overlay-toast__description">{item.description}</span>}
                        </div>
                        <div className="overlay-toast__actions">
                            {item.actionLabel && (
                                <PeriodicityButton
                                    variant="quiet"
                                    size="sm"
                                    onClick={() => {
                                        dismiss(item.id, "action");
                                    }}
                                >
                                    {item.actionLabel}
                                </PeriodicityButton>
                            )}
                            <PeriodicityButton
                                variant="quiet"
                                size="sm"
                                icon="Close"
                                aria-label="关闭通知"
                                onClick={() => {
                                    dismiss(item.id, "dismiss");
                                }}
                            />
                        </div>
                    </article>
                );
            })}
        </div>
    );
}

export default ToastWindow;
