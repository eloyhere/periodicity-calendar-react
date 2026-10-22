import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { PeriodicitySnackbar } from "periodicity-react";
import type { SnackbarCloseReason, SnackbarState } from "../../../electron/service/types";
import { useReportHeight } from "../shared/useReportHeight";

function SnackbarWindow() {
    const [state, setState]: [SnackbarState | null, Dispatch<SetStateAction<SnackbarState | null>>] = useState<SnackbarState | null>(null);
    const [open, setOpen]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);

    useEffect(() => {
        const unsubscribe: () => void = window.snackbar.onUpdate((next: SnackbarState | null) => {
            setState(next);
            setOpen(next !== null);
        });
        window.snackbar.ready();
        return unsubscribe;
    }, []);

    const reportHeight: (height: number) => void = useCallback((height: number): void => {
        window.snackbar.resize(height);
    }, []);

    useReportHeight(".snackbar", reportHeight);

    const handleClose: (reason: SnackbarCloseReason) => void = useCallback((reason: SnackbarCloseReason): void => {
        setOpen(false);
        window.snackbar.closed(reason);
    }, []);

    if (!state) {
        return null;
    }

    return (
        <PeriodicitySnackbar
            open={open}
            message={state.message}
            actionLabel={state.actionLabel}
            autoHideDuration={state.duration}
            anchor={state.anchor}
            tone={state.tone}
            onClose={handleClose}
        />
    );
}

export default SnackbarWindow;
