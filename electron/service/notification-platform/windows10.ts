import { WindowsNotificationPlatform } from "./windows-common";
import type { PlatformNotificationRequest } from "./types";

/**
 * Escapes text for a Windows toast XML payload.
 * @param value Raw text from the caller.
 * @return XML-safe text.
 */
function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

/**
 * Builds a Windows 10-compatible ToastGeneric template.
 * @param title Notification title.
 * @param body Notification body.
 * @param silent Whether the system sound is muted.
 * @return Toast XML string accepted by Electron's `toastXml` option.
 */
function buildToastXml(title: string, body: string, silent: boolean): string {
    const bodyLine: string = body.length > 0 ? `<text>${escapeXml(body)}</text>` : "";
    const audio: string = silent ? "<audio silent=\"true\" />" : "";
    return [
        "<toast duration=\"short\" activationType=\"foreground\">",
        "<visual>",
        "<binding template=\"ToastGeneric\">",
        `<text>${escapeXml(title)}</text>`,
        bodyLine,
        "</binding>",
        "</visual>",
        audio,
        "</toast>",
    ].join("");
}

/**
 * Windows 10 backend: explicit ToastGeneric XML for the legacy Action Center,
 * with a native fallback for persistent notifications.
 */
export class Windows10NotificationPlatform extends WindowsNotificationPlatform {
    public readonly id = "windows10" as const;
    public readonly label: string = "Windows 10";
    public readonly notes: string[] = [
        "需要带 AppUserModelID 和 ToastActivatorCLSID 的开始菜单快捷方式。",
        "开发环境自动创建 Periodicity Calendar (Dev) 开始菜单快捷方式。",
        "Windows 设置中的通知总开关必须开启；ToastEnabled=0 时不会显示任何通知。",
        "DisableNotificationCenter=1 策略会关闭通知中心并阻止 toast。",
        "使用 ToastGeneric XML（Action Center 兼容模式）。",
        "timeoutType=never 时回退到原生 Notification 持久选项。",
    ];

    /**
     * Builds Windows 10 notification options.
     * @param request Normalized notification request.
     * @return Native Notification options with a toast XML template.
     */
    protected buildOptions(
        request: PlatformNotificationRequest,
    ): Electron.NotificationConstructorOptions {
        const body: string = request.body ?? "";
        if (request.timeoutType === "never") {
            return {
                title: request.title,
                body: body.length > 0 ? body : (void 0),
                silent: request.silent,
                timeoutType: "never",
            };
        }
        return {
            title: request.title,
            body: body.length > 0 ? body : (void 0),
            silent: request.silent,
            toastXml: buildToastXml(request.title, body, request.silent),
        };
    }
}
