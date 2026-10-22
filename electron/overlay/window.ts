import { BrowserWindow } from "electron";
import { PRELOAD_PATH, loadWindowPage } from "../window/runtime";

export interface OverlayWindowOptions {
    page: string;
    width: number;
    height: number;
    parent?: BrowserWindow | null;
    title?: string;
    focusable?: boolean;
    modal?: boolean;
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
    const parent: BrowserWindow | null = options.parent ?? null;
    const win: BrowserWindow = new BrowserWindow({
        width: options.width,
        height: options.height,
        minWidth: options.minWidth,
        minHeight: options.minHeight,
        parent: parent ?? (void 0),
        modal: (options.modal ?? false) && parent !== null,
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

export type OverlayAnchor = "bottom-left" | "bottom-center" | "bottom-right" | "top-right" | "fill";

export interface OverlayPlacement {
    anchor: OverlayAnchor;
    width: number;
    height: number;
}

/**
 * Places an overlay window relative to its parent's content bounds.
 * @param win Overlay window to move.
 * @param parent Main window that owns the overlay.
 * @param placement Anchor, width, and height of the overlay surface.
 */
export function placeOverlay(win: BrowserWindow, parent: BrowserWindow, placement: OverlayPlacement): void {
    if (win.isDestroyed() || parent.isDestroyed()) {
        return;
    }
    const bounds: Electron.Rectangle = parent.getContentBounds();
    if (placement.anchor === "fill") {
        win.setBounds(bounds);
        return;
    }
    const width: number = Math.max(1, Math.min(placement.width, bounds.width));
    const height: number = Math.max(1, Math.min(placement.height, bounds.height));
    let x: number = bounds.x;
    let y: number = bounds.y;
    if (placement.anchor === "bottom-center") {
        x = bounds.x + Math.round((bounds.width - width) / 2);
        y = bounds.y + bounds.height - height;
    } else if (placement.anchor === "bottom-left") {
        x = bounds.x;
        y = bounds.y + bounds.height - height;
    } else if (placement.anchor === "bottom-right") {
        x = bounds.x + bounds.width - width;
        y = bounds.y + bounds.height - height;
    } else {
        x = bounds.x + bounds.width - width;
        y = bounds.y;
    }
    win.setBounds({ x, y, width, height });
}

/**
 * Keeps an overlay aligned while its parent moves, resizes, or enters full screen.
 * @param win Overlay window that follows the parent.
 * @param parent Main window that owns the overlay.
 * @param onChange Callback that re-applies the overlay bounds.
 * @return Cleanup function that removes all parent listeners.
 */
export function trackParentWindow(win: BrowserWindow, parent: BrowserWindow, onChange: () => void): () => void {
    const handler: () => void = () => {
        if (!win.isDestroyed()) {
            onChange();
        }
    };
    parent.on("resize", handler);
    parent.on("move", handler);
    parent.on("maximize", handler);
    parent.on("unmaximize", handler);
    parent.on("enter-full-screen", handler);
    parent.on("leave-full-screen", handler);
    parent.on("restore", handler);
    return (): void => {
        if (parent.isDestroyed()) {
            return;
        }
        parent.removeListener("resize", handler);
        parent.removeListener("move", handler);
        parent.removeListener("maximize", handler);
        parent.removeListener("unmaximize", handler);
        parent.removeListener("enter-full-screen", handler);
        parent.removeListener("leave-full-screen", handler);
        parent.removeListener("restore", handler);
    };
}
