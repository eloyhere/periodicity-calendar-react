import { BrowserWindow } from "electron";
import { PRELOAD_PATH, loadWindowPage } from "../window/runtime";

export interface OverlayWindowOptions {
    page: string;
    width: number;
    height: number;
    title?: string;
    focusable?: boolean;
    resizable?: boolean;
    movable?: boolean;
    transparent?: boolean;
    backgroundColor?: string;
    hasShadow?: boolean;
    skipTaskbar?: boolean;
    alwaysOnTop?: boolean;
    minWidth?: number;
    minHeight?: number;
    center?: boolean;
    thickFrame?: boolean;
}

/**
 * Creates one frameless renderer window used by an overlay process.
 * @param options Window page, size, chrome, and behaviour switches.
 * @return The hidden window, already loading its renderer entry.
 */
export function createOverlayWindow(options: OverlayWindowOptions): BrowserWindow {
    const win: BrowserWindow = new BrowserWindow({
        width: options.width,
        height: options.height,
        minWidth: options.minWidth,
        minHeight: options.minHeight,
        frame: false,
        transparent: options.transparent ?? true,
        backgroundColor: options.backgroundColor ?? "#00000000",
        hasShadow: options.hasShadow ?? false,
        resizable: options.resizable ?? false,
        movable: options.movable ?? false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: options.skipTaskbar ?? true,
        alwaysOnTop: options.alwaysOnTop ?? false,
        show: false,
        focusable: options.focusable ?? false,
        title: options.title ?? "Overlay",
        thickFrame: options.thickFrame ?? false,
        webPreferences: {
            preload: PRELOAD_PATH,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
            backgroundThrottling: false,
            partition: `overlay-${options.page}`,
        },
    });

    win.removeMenu();
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(() => {
        return { action: "deny" };
    });
    if (options.center) {
        win.center();
    }
    loadWindowPage(win, options.page);
    return win;
}

export type OverlayAnchor = "bottom-left" | "bottom-center" | "bottom-right" | "top-right" | "center" | "fill";

export interface OverlayPlacement {
    anchor: OverlayAnchor;
    width: number;
    height: number;
}

/**
 * Places an overlay window inside one screen or content rectangle.
 * @param win Overlay window to move.
 * @param area Screen work area or parent content bounds.
 * @param placement Anchor, width, and height of the overlay surface.
 */
export function placeWithin(win: BrowserWindow, area: Electron.Rectangle, placement: OverlayPlacement): void {
    if (win.isDestroyed()) {
        return;
    }
    if (placement.anchor === "fill") {
        win.setBounds(area);
        return;
    }
    const width: number = Math.max(1, Math.min(placement.width, area.width));
    const height: number = Math.max(1, Math.min(placement.height, area.height));
    let x: number = area.x;
    let y: number = area.y;
    if (placement.anchor === "bottom-center") {
        x = area.x + Math.round((area.width - width) / 2);
        y = area.y + area.height - height;
    } else if (placement.anchor === "bottom-left") {
        x = area.x;
        y = area.y + area.height - height;
    } else if (placement.anchor === "bottom-right") {
        x = area.x + area.width - width;
        y = area.y + area.height - height;
    } else if (placement.anchor === "center") {
        x = area.x + Math.round((area.width - width) / 2);
        y = area.y + Math.round((area.height - height) / 2);
    } else {
        x = area.x + area.width - width;
        y = area.y;
    }
    win.setBounds({ x, y, width, height });
}
