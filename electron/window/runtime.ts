import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserWindow } from "electron";

const here: string = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(here, "..");

export const VITE_DEV_SERVER_URL: string | undefined = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST: string = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST: string = path.join(process.env.APP_ROOT, "dist");
export const PRELOAD_PATH: string = path.join(MAIN_DIST, "preload.mjs");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;

/**
 * Builds the development or production URL of one renderer entry.
 * @param page Renderer entry name such as `snackbar`.
 * @return URL or file path of the matching HTML document.
 */
function windowPageUrl(page: string): string {
    if (VITE_DEV_SERVER_URL) {
        const base: string = VITE_DEV_SERVER_URL.endsWith("/") ? VITE_DEV_SERVER_URL : `${VITE_DEV_SERVER_URL}/`;
        return new URL(`windows/${page}.html`, base).toString();
    }
    return path.join(RENDERER_DIST, "windows", `${page}.html`);
}

/**
 * Loads one renderer entry into a window.
 * @param win Window that receives the document.
 * @param page Renderer entry name such as `dialog`.
 */
export function loadWindowPage(win: BrowserWindow, page: string): void {
    if (VITE_DEV_SERVER_URL) {
        void win.loadURL(windowPageUrl(page)).catch(() => {
            // did-fail-load is the authoritative failure path.
        });
        return;
    }
    void win.loadFile(windowPageUrl(page)).catch(() => {
        // did-fail-load is the authoritative failure path.
    });
}
