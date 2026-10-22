import { app, shell } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { BaseNotificationPlatform } from "./base";

/**
 * Shared Windows notification setup.
 * Electron requires a Start Menu shortcut with an AppUserModelID and a
 * ToastActivatorCLSID for toast notifications. Packaged builds get the
 * shortcut from the installer; development builds use electron.exe.
 */
export abstract class WindowsNotificationPlatform extends BaseNotificationPlatform {
    private prepared: boolean = false;
    private shortcutPrepared: boolean = false;

    public readonly requiresCodeSigning: boolean = false;
    public readonly requiresShortcut: boolean = true;

    /**
     * Applies the Windows AppUserModelID and, in development, creates a proper
     * Start Menu shortcut. Pinning electron.exe manually does not always create
     * a shortcut with the AppUserModelID property on Windows 10.
     */
    public async prepare(): Promise<void> {
        if (this.prepared) {
            return;
        }
        this.prepared = true;
        app.setAppUserModelId(app.isPackaged ? "com.periodicity.calendar" : process.execPath);
        if (!app.isPackaged) {
            this.ensureDevelopmentShortcut();
        }
    }

    /**
     * Writes a Start Menu shortcut whose AppUserModelID matches the running
     * electron.exe. This is the development equivalent of the shortcut that
     * Squirrel/NSIS creates for an installed build.
     */
    private ensureDevelopmentShortcut(): void {
        if (this.shortcutPrepared) {
            return;
        }
        this.shortcutPrepared = true;
        try {
            const programs: string = path.join(
                app.getPath("appData"),
                "Microsoft",
                "Windows",
                "Start Menu",
                "Programs",
            );
            mkdirSync(programs, { recursive: true });
            shell.writeShortcutLink(
                path.join(programs, "Periodicity Calendar (Dev).lnk"),
                "create",
                {
                    target: process.execPath,
                    args: `"${app.getAppPath()}"`,
                    cwd: app.getAppPath(),
                    description: "Periodicity Calendar development build",
                    appUserModelId: process.execPath,
                },
            );
        } catch {
            // Notification.isSupported() stays true; toasts may still work if
            // the user already pinned a valid shortcut manually.
        }
    }
}
