import { execFile, type ExecFileException } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ToolExecutionResult, WorkspaceInfo } from "../llm/types";

const SKIP_DIRECTORIES: ReadonlySet<string> = new Set<string>([
    ".git",
    "node_modules",
    "dist",
    "dist-electron",
    "git",
    "powershell",
    ".vscode",
]);
const MAX_FILES: number = 240;
const MAX_READ_CHARS: number = 120000;
const MAX_OUTPUT_CHARS: number = 20000;

interface ProcessResult {
    code: number;
    stdout: string;
    stderr: string;
}

function resolveWithinRoot(root: string, inputPath: string): string {
    const resolved: string = path.resolve(root, inputPath.length > 0 ? inputPath : ".");
    const relative: string = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`path escapes workspace: ${inputPath}`);
    }
    return resolved;
}

async function walkFiles(
    root: string,
    relative: string,
    depth: number,
    maxDepth: number,
    output: string[],
): Promise<void> {
    if (depth > maxDepth || output.length >= MAX_FILES) {
        return;
    }
    const directory: string = path.join(root, relative);
    let entries: fs.Dirent[] = [];
    try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
        return;
    }
    entries.sort((left: fs.Dirent, right: fs.Dirent): number => {
        return left.name.localeCompare(right.name);
    });
    for (const entry of entries) {
        if (output.length >= MAX_FILES) {
            return;
        }
        if (entry.name.startsWith(".") && entry.name !== ".gitignore") {
            continue;
        }
        if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) {
            continue;
        }
        const nextRelative: string = relative.length > 0 ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            await walkFiles(root, nextRelative, depth + 1, maxDepth, output);
        } else if (entry.isFile()) {
            output.push(nextRelative);
        }
    }
}

async function listFiles(root: string, relative: string, depth: number): Promise<string[]> {
    const output: string[] = [];
    await walkFiles(root, relative, 0, Math.min(4, Math.max(1, depth)), output);
    return output;
}

function gitExecutable(root: string): string {
    const candidates: string[] = [
        path.join(root, "git", "cmd", "git.exe"),
        path.join(root, "git", "bin", "git.exe"),
        path.join(root, "git", "git.exe"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return "git";
}

function pwshExecutable(root: string): string {
    const candidates: string[] = [
        path.join(root, "powershell", "pwsh.exe"),
        path.join(root, "powershell", "pwsh"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return process.platform === "win32" ? "powershell.exe" : "pwsh";
}

function processEnv(root: string): NodeJS.ProcessEnv {
    const pathParts: string[] = [
        path.join(root, "git", "cmd"),
        path.join(root, "powershell"),
        process.env.PATH ?? "",
    ];
    return {
        ...process.env,
        PATH: pathParts.filter((part: string): boolean => {
            return part.length > 0;
        }).join(path.delimiter),
    };
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ProcessResult> {
    return new Promise<ProcessResult>((resolve) => {
        execFile(
            command,
            args,
            {
                cwd,
                timeout: timeoutMs,
                maxBuffer: 2 * 1024 * 1024,
                windowsHide: true,
                env: processEnv(cwd),
                encoding: "utf8",
            },
            (error: ExecFileException | null, stdout: string, stderr: string) => {
                const rawCode: string | number | null | undefined = error?.code;
                const code: number = typeof rawCode === "number" ? rawCode : error ? 1 : 0;
                resolve({
                    code,
                    stdout,
                    stderr,
                });
            },
        );
    });
}

async function runGit(root: string, args: string[]): Promise<ProcessResult> {
    return runProcess(gitExecutable(root), ["-C", root, ...args], root, 30000);
}

function trimOutput(value: string): string {
    if (value.length <= MAX_OUTPUT_CHARS) {
        return value;
    }
    return `${value.slice(0, MAX_OUTPUT_CHARS)}\n… [truncated ${String(value.length - MAX_OUTPUT_CHARS)} chars]`;
}

export async function getWorkspaceInfo(root: string): Promise<WorkspaceInfo> {
    const files: string[] = await listFiles(root, "", 3);
    const status: ProcessResult = await runGit(root, ["status", "--short", "--branch"]);
    const statusText: string = status.code === 0 ? status.stdout.trim() : status.stderr.trim();
    const firstLine: string = statusText.split(/\r?\n/)[0] ?? "";
    const branch: string = firstLine.startsWith("## ")
        ? firstLine.slice(3).split("...")[0]?.trim() ?? "unknown"
        : "unknown";
    return {
        root,
        branch,
        files,
        gitStatus: trimOutput(statusText.length > 0 ? statusText : "工作区干净"),
        hasGit: status.code === 0,
    };
}

function argString(args: Record<string, unknown>, key: string, fallback: string = ""): string {
    const value: unknown = args[key];
    return typeof value === "string" ? value : fallback;
}

function argNumber(args: Record<string, unknown>, key: string, fallback: number): number {
    const value: unknown = args[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function createToolDefinitions(): Array<{
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}> {
    return [
        {
            type: "function",
            function: {
                name: "list_files",
                description: "List files inside the workspace. Use this before reading or editing unfamiliar code.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative directory path, default ." },
                        depth: { type: "number", description: "Recursion depth, 1-4" },
                    },
                    additionalProperties: false,
                },
            },
        },
        {
            type: "function",
            function: {
                name: "read_file",
                description: "Read a UTF-8 text file inside the workspace.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative file path" },
                    },
                    required: ["path"],
                    additionalProperties: false,
                },
            },
        },
        {
            type: "function",
            function: {
                name: "write_file",
                description: "Create or replace a UTF-8 text file inside the workspace. Use replace_in_file for small edits.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative file path" },
                        content: { type: "string", description: "Full file content" },
                    },
                    required: ["path", "content"],
                    additionalProperties: false,
                },
            },
        },
        {
            type: "function",
            function: {
                name: "replace_in_file",
                description: "Replace an exact string in a file. Fails if the old string is absent. Use for targeted edits.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative file path" },
                        old_string: { type: "string", description: "Exact text to replace" },
                        new_string: { type: "string", description: "Replacement text" },
                    },
                    required: ["path", "old_string", "new_string"],
                    additionalProperties: false,
                },
            },
        },
        {
            type: "function",
            function: {
                name: "search_files",
                description: "Search text files inside the workspace and return path:line matches.",
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Case-insensitive literal text" },
                        path: { type: "string", description: "Relative directory, default ." },
                    },
                    required: ["query"],
                    additionalProperties: false,
                },
            },
        },
        {
            type: "function",
            function: {
                name: "run_powershell",
                description: "Run a PowerShell command in the workspace. Use for builds, tests, git, and scripts. Returns stdout/stderr.",
                parameters: {
                    type: "object",
                    properties: {
                        command: { type: "string", description: "PowerShell command" },
                    },
                    required: ["command"],
                    additionalProperties: false,
                },
            },
        },
        {
            type: "function",
            function: {
                name: "git_status",
                description: "Show git status for the workspace.",
                parameters: {
                    type: "object",
                    properties: {},
                    additionalProperties: false,
                },
            },
        },
        {
            type: "function",
            function: {
                name: "git_diff",
                description: "Show the current git diff for the workspace.",
                parameters: {
                    type: "object",
                    properties: {},
                    additionalProperties: false,
                },
            },
        },
    ];
}

export async function executeTool(
    root: string,
    name: string,
    args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
    try {
        if (name === "list_files") {
            const relative: string = argString(args, "path", ".");
            const depth: number = argNumber(args, "depth", 2);
            const files: string[] = await listFiles(resolveWithinRoot(root, relative), "", depth);
            return {
                ok: true,
                output: files.length > 0 ? files.join("\n") : "(empty)",
            };
        }
        if (name === "read_file") {
            const filePath: string = resolveWithinRoot(root, argString(args, "path"));
            const content: string = await fs.promises.readFile(filePath, "utf8");
            if (content.includes("\u0000")) {
                return { ok: false, output: "binary file refused" };
            }
            return {
                ok: true,
                output: content.length > MAX_READ_CHARS
                    ? `${content.slice(0, MAX_READ_CHARS)}\n… [truncated ${String(content.length - MAX_READ_CHARS)} chars]`
                    : content,
            };
        }
        if (name === "write_file") {
            const filePath: string = resolveWithinRoot(root, argString(args, "path"));
            const content: string = argString(args, "content");
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            await fs.promises.writeFile(filePath, content, "utf8");
            return {
                ok: true,
                output: `wrote ${String(Buffer.byteLength(content, "utf8"))} bytes to ${path.relative(root, filePath)}`,
            };
        }
        if (name === "replace_in_file") {
            const filePath: string = resolveWithinRoot(root, argString(args, "path"));
            const oldString: string = argString(args, "old_string");
            const newString: string = argString(args, "new_string");
            if (oldString.length === 0) {
                return { ok: false, output: "old_string must not be empty" };
            }
            const current: string = await fs.promises.readFile(filePath, "utf8");
            const count: number = current.split(oldString).length - 1;
            if (count === 0) {
                return { ok: false, output: "old_string not found" };
            }
            await fs.promises.writeFile(filePath, current.split(oldString).join(newString), "utf8");
            return {
                ok: true,
                output: `replaced ${String(count)} occurrence(s) in ${path.relative(root, filePath)}`,
            };
        }
        if (name === "search_files") {
            const query: string = argString(args, "query");
            if (query.length === 0) {
                return { ok: false, output: "query must not be empty" };
            }
            const relative: string = argString(args, "path", ".");
            const files: string[] = await listFiles(resolveWithinRoot(root, relative), "", 4);
            const matches: string[] = [];
            const needle: string = query.toLowerCase();
            for (const file of files) {
                if (matches.length >= 40) {
                    break;
                }
                const filePath: string = path.join(root, file);
                try {
                    const content: string = await fs.promises.readFile(filePath, "utf8");
                    if (content.includes("\u0000")) {
                        continue;
                    }
                    const lines: string[] = content.split(/\r?\n/);
                    for (let index: number = 0; index < lines.length; index += 1) {
                        if (lines[index].toLowerCase().includes(needle)) {
                            matches.push(`${file}:${String(index + 1)}: ${lines[index].trim().slice(0, 200)}`);
                            if (matches.length >= 40) {
                                break;
                            }
                        }
                    }
                } catch {
                    // Skip unreadable files.
                }
            }
            return {
                ok: true,
                output: matches.length > 0 ? matches.join("\n") : "(no matches)",
            };
        }
        if (name === "run_powershell") {
            const command: string = argString(args, "command");
            if (command.trim().length === 0) {
                return { ok: false, output: "command must not be empty" };
            }
            const result: ProcessResult = await runProcess(
                pwshExecutable(root),
                ["-NoProfile", "-NonInteractive", "-Command", command],
                root,
                60000,
            );
            const combined: string = [result.stdout, result.stderr].filter((part: string): boolean => {
                return part.trim().length > 0;
            }).join("\n");
            return {
                ok: result.code === 0,
                output: trimOutput(`exit ${String(result.code)}\n${combined.length > 0 ? combined : "(no output)"}`),
            };
        }
        if (name === "git_status") {
            const result: ProcessResult = await runGit(root, ["status", "--short", "--branch"]);
            return {
                ok: result.code === 0,
                output: trimOutput(result.code === 0 ? result.stdout || "(clean)" : result.stderr),
            };
        }
        if (name === "git_diff") {
            const stats: ProcessResult = await runGit(root, ["diff", "--stat"]);
            const diff: ProcessResult = await runGit(root, ["diff", "--", "."]);
            return {
                ok: stats.code === 0 && diff.code === 0,
                output: trimOutput(`${stats.stdout}\n${diff.stdout}`.trim() || "(no diff)"),
            };
        }
        return { ok: false, output: `unknown tool: ${name}` };
    } catch (error: unknown) {
        return {
            ok: false,
            output: error instanceof Error ? error.message : "tool execution failed",
        };
    }
}
