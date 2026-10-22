import { WindowsNotificationPlatform } from "./windows-common";
import type { PlatformNotificationRequest } from "./types";

/**
 * Windows 11 backend: native WinRT toast options rendered by the Windows 11
 * Notification Center, including its focus/priority behavior.
 */
export class Windows11NotificationPlatform extends WindowsNotificationPlatform {
    public readonly id = "windows11" as const;
    public readonly label: string = "Windows 11";
    public readonly notes: string[] = [
        "需要带 AppUserModelID 和 ToastActivatorCLSID 的开始菜单快捷方式。",
        "开发环境自动创建 Periodicity Calendar (Dev) 开始菜单快捷方式。",
        "Windows 设置中的通知总开关必须开启；ToastEnabled=0 时不会显示任何通知。",
        "DisableNotificationCenter=1 策略会关闭通知中心并阻止 toast。",
        "使用原生 WinRT Toast，由 Windows 11 通知中心管理。",
        "专注助手/通知设置可能静默丢弃横幅。",
    ];

    /**
     * Builds Windows 11 notification options.
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
        };
    }
}
