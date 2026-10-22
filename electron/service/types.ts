export type SnackbarTone = "neutral" | "success" | "warning" | "danger";

export type SnackbarAnchor = "bottom-left" | "bottom-center" | "bottom-right";

export type SnackbarCloseReason =
    | "action"
    | "dismiss"
    | "timeout"
    | "replaced"
    | "hidden"
    | "window-closed"
    | "failed";

export interface SnackbarOptions {
    message: string;
    tone?: SnackbarTone;
    actionLabel?: string;
    duration?: number;
    anchor?: SnackbarAnchor;
}

export interface SnackbarState {
    id: string;
    message: string;
    tone: SnackbarTone;
    actionLabel?: string;
    duration: number;
    anchor: SnackbarAnchor;
}

export interface SnackbarResult {
    id: string;
    reason: SnackbarCloseReason;
}

export interface SnackbarApi {
    show: (options: SnackbarOptions) => Promise<SnackbarResult>;
    hide: () => void;
    onUpdate: (callback: (state: SnackbarState | null) => void) => () => void;
    ready: () => void;
    resize: (height: number) => void;
    closed: (reason: SnackbarCloseReason) => void;
}

export type ToastTone = "neutral" | "success" | "warning" | "danger";

export type ToastDismissReason =
    | "action"
    | "dismiss"
    | "timeout"
    | "programmatic"
    | "window-closed"
    | "failed";

export interface ToastOptions {
    title: string;
    description?: string;
    tone?: ToastTone;
    duration?: number;
    actionLabel?: string;
}

export interface ToastItem {
    id: string;
    title: string;
    description?: string;
    tone: ToastTone;
    duration: number;
    actionLabel?: string;
}

export interface ToastResult {
    id: string;
    reason: ToastDismissReason;
}

export interface ToastApi {
    show: (options: ToastOptions) => Promise<ToastResult>;
    dismiss: (id: string) => void;
    onUpdate: (callback: (items: ToastItem[]) => void) => () => void;
    ready: () => void;
    resize: (height: number) => void;
    closed: (id: string, reason: ToastDismissReason) => void;
}

export type DialogSize = "sm" | "md" | "lg";

export type DialogTone = "neutral" | "success" | "warning" | "danger";

export type DialogAction = "confirm" | "cancel" | "dismiss";

export interface DialogInputOptions {
    label: string;
    placeholder?: string;
    value?: string;
    required?: boolean;
    maxLength?: number;
}

export interface DialogOptions {
    title: string;
    description?: string;
    message?: string;
    eyebrow?: string;
    tone?: DialogTone;
    size?: DialogSize;
    confirmLabel?: string;
    cancelLabel?: string;
    showCancel?: boolean;
    input?: DialogInputOptions;
}

export interface DialogResult {
    action: DialogAction;
    value?: string;
}

export interface DialogApi {
    open: (options: DialogOptions) => Promise<DialogResult>;
    onRequest: (callback: (options: DialogOptions) => void) => () => void;
    ready: () => void;
    resolve: (result: DialogResult) => void;
}

export type DaemonErrorKind =
    | "main-exception"
    | "main-rejection"
    | "renderer-error"
    | "renderer-gone"
    | "preload-error"
    | "load-failure"
    | "child-process-gone"
    | "unresponsive";

export interface DaemonErrorInput {
    kind: DaemonErrorKind;
    message: string;
    stack?: string;
    source?: string;
    detail?: string;
    fatal?: boolean;
}

export interface DaemonErrorRecord extends DaemonErrorInput {
    id: string;
    at: string;
    sequence: number;
    count: number;
}

export interface DaemonSnapshot {
    errors: DaemonErrorRecord[];
    appVersion: string;
    electronVersion: string;
    platform: string;
    mainWindowAlive: boolean;
    logPath: string;
    total: number;
}

export type DaemonAction = "dismiss" | "reload" | "quit" | "copy";

export interface DaemonApi {
    report: (error: DaemonErrorInput) => void;
    onSnapshot: (callback: (snapshot: DaemonSnapshot) => void) => () => void;
    ready: () => void;
    action: (action: DaemonAction, errorId?: string) => Promise<void>;
}
