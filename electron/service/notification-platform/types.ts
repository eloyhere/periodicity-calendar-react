import type {
    NotificationPlatformInfo,
    SystemNotificationTimeout,
    SystemNotificationUrgency,
} from "../types";

export interface PlatformNotificationRequest {
    id: string;
    title: string;
    body?: string;
    subtitle?: string;
    silent: boolean;
    urgency: SystemNotificationUrgency;
    timeoutType: SystemNotificationTimeout;
    sound?: string;
}

export interface PlatformNotificationCallbacks {
    onShow: () => void;
    onClick: () => void;
    onClose: () => void;
    onFailed: (error: string) => void;
    onAction: (index: number) => void;
}

export interface PlatformNotificationHandle {
    close: () => void;
}

export interface NotificationPlatformService {
    getInfo: () => NotificationPlatformInfo;
    prepare: () => Promise<void>;
    show: (
        request: PlatformNotificationRequest,
        callbacks: PlatformNotificationCallbacks,
    ) => PlatformNotificationHandle;
}
