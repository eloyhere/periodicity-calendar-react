import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { LlmPublicSettings, LlmSaveSettings, LlmSettings } from "./types";

const SETTINGS_FILE_NAME: string = "llm-settings.json";
const DEFAULT_BASE_URL: string = "https://api.deepseek.com";
const DEFAULT_MODEL: string = "deepseek-flash";

/**
 * Resolves the JSON file that stores the model and workspace settings.
 * @return Absolute path inside the Electron userData directory.
 */
export function settingsPath(): string {
    return path.join(app.getPath("userData"), SETTINGS_FILE_NAME);
}

function envApiKey(): string {
    return process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? "";
}

function envBaseUrl(): string {
    return process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL;
}

function envModel(): string {
    return process.env.LLM_MODEL ?? DEFAULT_MODEL;
}

function envWorkspace(): string {
    return process.env.PERIODICITY_WORKSPACE ?? process.cwd();
}

function normalizeBaseUrl(value: string): string {
    const trimmed: string = value.trim().replace(/\/+$/, "");
    if (trimmed.length === 0) {
        return DEFAULT_BASE_URL;
    }
    return trimmed;
}

function normalizeWorkspace(value: string): string {
    const candidate: string = path.resolve(value.trim().length > 0 ? value.trim() : envWorkspace());
    try {
        const stat: fs.Stats = fs.statSync(candidate);
        if (stat.isDirectory()) {
            return candidate;
        }
    } catch {
        // Fall through to the process working directory.
    }
    return process.cwd();
}

function defaultSettings(): LlmSettings {
    return {
        baseUrl: normalizeBaseUrl(envBaseUrl()),
        model: process.env.LLM_MODEL ?? envModel(),
        apiKey: envApiKey(),
        workspaceRoot: normalizeWorkspace(envWorkspace()),
    };
}

/**
 * Reads the stored key while preserving an intentionally cleared value.
 * @param parsed Settings parsed from disk.
 * @param fallback Environment-derived defaults.
 * @return The stored key, or the environment key when the file never stored one.
 */
function resolveApiKey(parsed: Partial<LlmSettings>, fallback: LlmSettings): string {
    if (typeof parsed.apiKey === "string") {
        return parsed.apiKey.trim();
    }
    return fallback.apiKey;
}

/**
 * Writes the full settings snapshot to disk, creating the directory when needed.
 * @param settings Settings to serialize as JSON.
 */
function persistSettings(settings: LlmSettings): void {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function loadSettings(): LlmSettings {
    const fallback: LlmSettings = defaultSettings();
    try {
        const raw: string = fs.readFileSync(settingsPath(), "utf8");
        const parsed: Partial<LlmSettings> = JSON.parse(raw) as Partial<LlmSettings>;
        return {
            baseUrl: normalizeBaseUrl(parsed.baseUrl ?? fallback.baseUrl),
            model: (parsed.model ?? fallback.model).trim() || fallback.model,
            apiKey: resolveApiKey(parsed, fallback),
            workspaceRoot: normalizeWorkspace(parsed.workspaceRoot ?? fallback.workspaceRoot),
        };
    } catch {
        return fallback;
    }
}

export function publicSettings(settings?: LlmSettings): LlmPublicSettings {
    const current: LlmSettings = settings ?? loadSettings();
    return {
        baseUrl: current.baseUrl,
        model: current.model,
        workspaceRoot: current.workspaceRoot,
        hasKey: current.apiKey.length > 0,
    };
}

export function saveSettings(input: LlmSaveSettings): LlmPublicSettings {
    const existing: LlmSettings = loadSettings();
    const next: LlmSettings = {
        baseUrl: normalizeBaseUrl(input.baseUrl || existing.baseUrl),
        model: (input.model || existing.model).trim() || existing.model,
        apiKey: input.apiKey.trim().length > 0 ? input.apiKey.trim() : existing.apiKey,
        workspaceRoot: normalizeWorkspace(input.workspaceRoot || existing.workspaceRoot),
    };
    persistSettings(next);
    return publicSettings(next);
}

/**
 * Removes the API key stored on this machine while keeping the other settings.
 * @return Public settings snapshot with `hasKey` set to false.
 */
export function clearApiKey(): LlmPublicSettings {
    const existing: LlmSettings = loadSettings();
    const next: LlmSettings = { ...existing, apiKey: "" };
    persistSettings(next);
    return publicSettings(next);
}
