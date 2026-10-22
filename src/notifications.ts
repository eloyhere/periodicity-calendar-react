import type {
    DialogOptions,
    DialogResult,
    SnackbarOptions,
    SnackbarResult,
    ToastOptions,
} from "../electron/service/types";

/**
 * Opens the dedicated Dialog window and resolves when it closes.
 * @param options Dialog content and action labels.
 * @return The chosen action, or null when the dialog process is unavailable.
 */
export async function openDialog(options: DialogOptions): Promise<DialogResult | null> {
    try {
        return await window.dialog.open(options);
    } catch {
        return null;
    }
}

/**
 * Shows one Snackbar and resolves when it closes.
 * @param options Message, tone, action, duration, and anchor.
 * @return Close reason, or null when the snackbar process is unavailable.
 */
export async function showSnackbar(options: SnackbarOptions): Promise<SnackbarResult | null> {
    try {
        return await window.snackbar.show(options);
    } catch {
        return null;
    }
}

/**
 * Shows one Toast without blocking the caller.
 * @param options Title, description, tone, duration, and optional action.
 */
export function showToast(options: ToastOptions): void {
    void window.toast.show(options).catch(() => {
        // The toast window is optional; shutdown can remove it mid-request.
    });
}
