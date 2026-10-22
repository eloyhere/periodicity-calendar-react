import { BaseNotificationPlatform } from "./base";
import type { PlatformNotificationRequest } from "./types";

const MACOS_NOTIFICATION_BYTE_LIMIT: number = 256;

/**
 * Counts UTF-8 bytes in a string.
 * @param value String to measure.
 * @return Byte length as stored by macOS.
 */
function byteLength(value: string): number {
    return Buffer.byteLength(value, "utf8");
}

/**
 * Truncates a string to a UTF-8 byte budget without leaving a broken suffix.
 * @param value String to truncate.
 * @param maxBytes Maximum UTF-8 byte count.
 * @return Truncated string.
 */
function truncateUtf8(value: string, maxBytes: number): string {
    if (maxBytes <= 0) {
        return "";
    }
    if (byteLength(value) <= maxBytes) {
        return value;
    }
    return Buffer.from(value, "utf8")
        .subarray(0, maxBytes)
        .toString("utf8")
        .replace(/\uFFFD+$/u, "");
}

/**
 * macOS backend using UNNotification. Apple requires the app to be code-signed
 * for notification delivery; unsigned builds receive a `failed` event.
 */
export class MacOsNotificationPlatform extends BaseNotificationPlatform {
    public readonly id = "macos" as const;
    public readonly label: string = "macOS";
    public readonly requiresCodeSigning: boolean = true;
    public readonly requiresShortcut: boolean = false;
    public readonly notes: string[] = [
        "使用 UNNotification，需要代码签名；未签名构建会触发 failed。",
        "通知内容总大小约 256 字节，超出会被截断。",
        "支持 subtitle、sound 与通知中心历史。",
    ];

    /**
     * Builds macOS notification options within Apple's payload budget.
     * @param request Normalized notification request.
     * @return Native Notification options.
     */
    protected buildOptions(
        request: PlatformNotificationRequest,
    ): Electron.NotificationConstructorOptions {
        const title: string = truncateUtf8(request.title, 96);
        const subtitle: string = request.subtitle ? truncateUtf8(request.subtitle, 64) : "";
        const overhead: number = byteLength(title) + (subtitle.length > 0 ? byteLength(subtitle) : 0) + 4;
        const body: string = request.body
            ? truncateUtf8(request.body, Math.max(0, MACOS_NOTIFICATION_BYTE_LIMIT - overhead))
            : "";
        return {
            title,
            subtitle: subtitle.length > 0 ? subtitle : (void 0),
            body: body.length > 0 ? body : (void 0),
            silent: request.silent,
            sound: request.sound,
        };
    }
}
