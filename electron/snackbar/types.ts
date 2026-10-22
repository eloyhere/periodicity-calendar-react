/**
 * Compatibility shim: snackbar types now live in `electron/service/types.ts`.
 */
export type {
    SnackbarAnchor,
    SnackbarApi,
    SnackbarCloseReason,
    SnackbarOptions,
    SnackbarResult,
    SnackbarState,
    SnackbarTone,
} from "../service/types";
