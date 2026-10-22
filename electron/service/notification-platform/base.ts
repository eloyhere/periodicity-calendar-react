import { Notification } from "electron";
import type { NotificationPlatformInfo } from "../types";
import type {
    NotificationPlatformService,
    PlatformNotificationCallbacks,
    PlatformNotificationHandle,
    PlatformNotificationRequest,
} from "./types";

/**
 * Base implementation for a platform-specific notification backend.
 * Subclasses only choose the native notification options; event wiring and
 * support metadata stay shared.
 */
export abstract class BaseNotificationPlatform implements NotificationPlatformService {
    public abstract readonly id: NotificationPlatformInfo["id"];
    public abstract readonly label: string;
    public abstract readonly requiresCodeSigning: boolean;
    public abstract readonly requiresShortcut: boolean;
    public abstract readonly notes: string[];

    /**
     * Builds the native options for one platform.
     * @param request Normalized notification request.
     * @return Options passed to Electron's Notification constructor.
     */
    protected abstract buildOptions(
        request: PlatformNotificationRequest,
    ): Electron.NotificationConstructorOptions;

    /**
     * Returns current platform capabilities and setup requirements.
     * @return Platform identifier, support state, and notes.
     */
    public getInfo(): NotificationPlatformInfo {
        return {
            id: this.id,
            label: this.label,
            version: process.getSystemVersion(),
            supported: Notification.isSupported(),
            requiresCodeSigning: this.requiresCodeSigning,
            requiresShortcut: this.requiresShortcut,
            notes: [...this.notes],
        };
    }

    /**
     * Performs platform setup before the first notification.
     */
    public async prepare(): Promise<void> {
        // Most platforms need no setup beyond the Notification constructor.
    }

    /**
     * Creates and shows one native notification.
     * @param request Normalized notification request.
     * @param callbacks Native event callbacks.
     * @return A handle that can dismiss the notification.
     */
    public show(
        request: PlatformNotificationRequest,
        callbacks: PlatformNotificationCallbacks,
    ): PlatformNotificationHandle {
        const notification: Notification = new Notification(this.buildOptions(request));
        notification.on("show", () => {
            callbacks.onShow();
        });
        notification.on("click", () => {
            callbacks.onClick();
        });
        notification.on("close", () => {
            callbacks.onClose();
        });
        notification.on("failed", (_event, error: string) => {
            callbacks.onFailed(error);
        });
        notification.on("action", (_event, index: number) => {
            callbacks.onAction(index);
        });
        notification.show();
        return {
            close: (): void => {
                notification.close();
            },
        };
    }
}
