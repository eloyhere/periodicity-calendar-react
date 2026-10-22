import { GenericNotificationPlatform } from "./generic";
import { MacOsNotificationPlatform } from "./macos";
import { Windows10NotificationPlatform } from "./windows10";
import { Windows11NotificationPlatform } from "./windows11";
import type { NotificationPlatformService } from "./types";

const WINDOWS_11_BUILD: number = 22000;

/**
 * Reads the Windows build number from Electron's OS version string.
 * @return Build number, or zero when unavailable.
 */
function windowsBuildNumber(): number {
    const parts: string[] = process.getSystemVersion().split(".");
    const build: number = Number.parseInt(parts[2] ?? "0", 10);
    return Number.isFinite(build) ? build : 0;
}

/**
 * Chooses the notification backend for the current operating system.
 * @return Windows 10, Windows 11, macOS, or generic implementation.
 */
export function createNotificationPlatform(): NotificationPlatformService {
    if (process.platform === "win32") {
        return windowsBuildNumber() >= WINDOWS_11_BUILD
            ? new Windows11NotificationPlatform()
            : new Windows10NotificationPlatform();
    }
    if (process.platform === "darwin") {
        return new MacOsNotificationPlatform();
    }
    return new GenericNotificationPlatform();
}

export * from "./types";
export { GenericNotificationPlatform } from "./generic";
export { MacOsNotificationPlatform } from "./macos";
export { Windows10NotificationPlatform } from "./windows10";
export { Windows11NotificationPlatform } from "./windows11";
