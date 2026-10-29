import { defineConfig } from "vite";
import path from "node:path";
import electron from "vite-plugin-electron/simple";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
    server: {
        host: "127.0.0.1",
        port: 4493,
        strictPort: true,
    },
    plugins: [
        react(),
        electron({
            main: {
                // Shortcut of `build.lib.entry`.
                entry: "electron/window/main.ts",
            },
            preload: {
                // Shortcut of `build.rollupOptions.input`.
                // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
                input: path.join(__dirname, "electron/preload/preload.ts"),
            },
            // Ployfill the Electron and Node.js API for Renderer process.
            // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
            // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
            renderer: process.env.NODE_ENV === "test"
                // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
                ? (void 0)
                : {},
        }),
    ],
    build: {
        rollupOptions: {
            input: {
                main: path.join(__dirname, "index.html"),
                snackbar: path.join(__dirname, "windows/snackbar.html"),
                dialog: path.join(__dirname, "windows/dialog.html"),
                toast: path.join(__dirname, "windows/toast.html"),
                daemon: path.join(__dirname, "windows/daemon.html"),
                notification: path.join(__dirname, "windows/notification.html"),
            },
        },
    },
});
