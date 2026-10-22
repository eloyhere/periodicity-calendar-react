/**
 * Compatibility shim: toast types now live in `electron/service/types.ts`.
 */
export type {
    ToastApi,
    ToastDismissReason,
    ToastItem,
    ToastOptions,
    ToastResult,
    ToastTone,
} from "../service/types";
