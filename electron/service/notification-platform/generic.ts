import { BaseNotificationPlatform } from "./base";
import type { PlatformNotificationRequest } from "./types";

/**
 * Fallback backend for platforms outside the Windows 10/11/macOS matrix.
 */
export class GenericNotificationPlatform extends BaseNotificationPlatform {
    public readonly id = "generic" as const;
    public readonly label: string = process.platform === "linux" ? "Linux" : process.platform;
    public readonly requiresCodeSigning: boolean = false;
    public readonly requiresShortcut: boolean = false;
    public readonly notes: string[] = [
        "使用 Electron 的跨平台 Notification 回退实现。",
        "具体可用性取决于桌面环境的通知服务。",
    ];

    /**
     * Builds fallback notification options.
     * @param request Normalized notification request.
     * @return Native Notification options.
     */
    protected buildOptions(
        request: PlatformNotificationRequest,
    ): Electron.NotificationConstructorOptions {
        const body: string = request.body ?? "";
        return {
            title: request.title,
            body: body.length > 0 ? body : (void 0),
            silent: request.silent,
            timeoutType: request.timeoutType,
            urgency: process.platform === "linux" ? request.urgency : (void 0),
        };
    }
}
