import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
    PeriodicityButton,
    PeriodicityDialog,
    PeriodicityTextInput,
} from "periodicity-react";
import type { DialogAction, DialogOptions } from "../../../electron/service/types";
import "./DialogWindow.css";

function DialogWindow() {
    const [request, setRequest]: [DialogOptions | null, Dispatch<SetStateAction<DialogOptions | null>>] = useState<DialogOptions | null>(null);
    const [value, setValue]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");

    useEffect(() => {
        const unsubscribe: () => void = window.dialog.onRequest((next: DialogOptions) => {
            setRequest(next);
            setValue(next.input?.value ?? "");
        });
        window.dialog.ready();
        return unsubscribe;
    }, []);

    const finish: (action: DialogAction) => void = useCallback((action: DialogAction): void => {
        window.dialog.resolve({
            action,
            value: request?.input ? value : (void 0),
        });
        setRequest(null);
    }, [request, value]);

    if (!request) {
        return null;
    }

    const canConfirm: boolean = request.input?.required !== true || value.trim().length > 0;

    const handleConfirm: () => void = (): void => {
        if (canConfirm) {
            finish("confirm");
        }
    };

    return (
        <PeriodicityDialog
            open
            onClose={() => {
                finish("cancel");
            }}
            title={request.title}
            eyebrow={request.eyebrow}
            description={request.description}
            size={request.size}
            role={request.tone === "danger" ? "alertdialog" : "dialog"}
            footer={
                <div className="dialog-window__actions">
                    {request.showCancel !== false && (
                        <PeriodicityButton
                            variant="ghost"
                            onClick={() => {
                                finish("cancel");
                            }}
                        >
                            {request.cancelLabel ?? "取消"}
                        </PeriodicityButton>
                    )}
                    <PeriodicityButton
                        icon="Check"
                        onClick={handleConfirm}
                        disabled={!canConfirm}
                    >
                        {request.confirmLabel ?? "确定"}
                    </PeriodicityButton>
                </div>
            }
        >
            {request.input ? (
                <PeriodicityTextInput
                    label={request.input.label}
                    placeholder={request.input.placeholder}
                    value={value}
                    maxLength={request.input.maxLength}
                    required={request.input.required}
                    autoFocus
                    onChange={(event) => {
                        setValue(event.target.value);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            handleConfirm();
                        }
                    }}
                />
            ) : null}
            {request.message ? (
                <p className="dialog-window__message">{request.message}</p>
            ) : null}
            {!request.input && !request.message ? <span className="dialog-window__spacer" /> : null}
        </PeriodicityDialog>
    );
}

export default DialogWindow;
