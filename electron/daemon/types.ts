/**
 * Compatibility shim: guardian types now live in `electron/service/types.ts`.
 */
export type {
    DaemonAction,
    DaemonApi,
    DaemonErrorInput,
    DaemonErrorKind,
    DaemonErrorRecord,
    DaemonSnapshot,
} from "../service/types";
