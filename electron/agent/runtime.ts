import { loadSettings } from "../llm/settings";
import { callModel } from "../llm/provider";
import type {
    AgentEvent,
    AgentRunRequest,
    AgentRunResult,
    LlmChatMessage,
    LlmProviderResult,
    LlmSettings,
    LlmToolDefinition,
    LlmUsage,
    ToolExecutionResult,
} from "../llm/types";
import { createToolDefinitions, executeTool } from "./tools";

const MAX_TOOL_STEPS: number = 8;
const MAX_TOOL_OUTPUT: number = 12000;

function systemPrompt(root: string): string {
    return [
        "你是一个在本地工作目录中操作文件与命令的工程代理。",
        `工作目录: ${root}`,
        "你可以读取、搜索、修改工作目录内的文件，可以运行 PowerShell、git、构建和测试。",
        "工作方式：先观察，再修改，再验证。可以试错；失败时读错误、修正、重试，不要假装执行。",
        "每次修改后尽量运行相关的 lint / typecheck / test。不要访问工作目录之外的路径。",
        "修改文件时优先使用 replace_in_file；需要整文件重写时使用 write_file。",
        "最终回答用中文，简洁说明改了什么、验证结果、剩余风险。",
    ].join("\n");
}

function appendUsage(total: LlmUsage | undefined, next: LlmUsage | undefined): LlmUsage | undefined {
    if (!next) {
        return total;
    }
    if (!total) {
        return next;
    }
    return {
        prompt_tokens: total.prompt_tokens + next.prompt_tokens,
        completion_tokens: total.completion_tokens + next.completion_tokens,
        total_tokens: total.total_tokens + next.total_tokens,
    };
}

function parseToolArguments(raw: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // Fall through to empty arguments.
    }
    return {};
}

function trimToolOutput(value: string): string {
    if (value.length <= MAX_TOOL_OUTPUT) {
        return value;
    }
    return `${value.slice(0, MAX_TOOL_OUTPUT)}\n… [truncated ${String(value.length - MAX_TOOL_OUTPUT)} chars]`;
}

function historyMessages(history: LlmChatMessage[] | undefined): LlmChatMessage[] {
    if (!history) {
        return [];
    }
    return history
        .filter((message: LlmChatMessage): boolean => {
            return (message.role === "user" || message.role === "assistant") && typeof message.content === "string";
        })
        .slice(-10)
        .map((message: LlmChatMessage): LlmChatMessage => {
            return {
                role: message.role,
                content: message.content,
            };
        });
}

export async function runAgent(
    request: AgentRunRequest,
    emit: (event: AgentEvent) => void,
): Promise<AgentRunResult> {
    const settings: LlmSettings = loadSettings();
    const events: AgentEvent[] = [];
    const push: (event: AgentEvent) => void = (event) => {
        events.push(event);
        emit(event);
    };
    if (request.prompt.trim().length === 0) {
        const message: string = "任务不能为空。";
        push({ type: "error", message });
        return { ok: false, content: message, events, error: message };
    }
    if (settings.apiKey.length === 0) {
        const message: string = "未配置模型 API Key。请在设置中填写后再运行工作流。";
        push({ type: "error", message });
        return { ok: false, content: message, events, error: message };
    }
    const messages: LlmChatMessage[] = [
        { role: "system", content: systemPrompt(settings.workspaceRoot) },
        ...historyMessages(request.history),
        { role: "user", content: request.prompt },
    ];
    const tools: LlmToolDefinition[] = createToolDefinitions();
    let usage: LlmUsage | undefined = (void 0);
    try {
        for (let step: number = 0; step < MAX_TOOL_STEPS; step += 1) {
            const response: LlmProviderResult = await callModel(settings, messages, tools);
            usage = appendUsage(usage, response.usage);
            if (response.content.trim().length > 0) {
                push({ type: "assistant", content: response.content });
            }
            if (response.toolCalls.length === 0) {
                const content: string = response.content.trim().length > 0
                    ? response.content
                    : "模型没有返回内容。";
                push({ type: "final", content, usage });
                return { ok: true, content, events, usage };
            }
            messages.push({
                role: "assistant",
                content: response.content.trim().length > 0 ? response.content : null,
                tool_calls: response.toolCalls,
            });
            for (const toolCall of response.toolCalls) {
                const startedAt: number = Date.now();
                push({
                    type: "tool_call",
                    id: toolCall.id,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments,
                });
                const args: Record<string, unknown> = parseToolArguments(toolCall.function.arguments);
                const result: ToolExecutionResult = await executeTool(settings.workspaceRoot, toolCall.function.name, args);
                const durationMs: number = Date.now() - startedAt;
                const output: string = trimToolOutput(result.output);
                push({
                    type: "tool_result",
                    id: toolCall.id,
                    name: toolCall.function.name,
                    ok: result.ok,
                    output,
                    durationMs,
                });
                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: toolCall.function.name,
                    content: result.ok ? output : `ERROR: ${output}`,
                });
            }
        }
        const message: string = `达到最大工具轮次（${String(MAX_TOOL_STEPS)}），任务未收敛。`;
        push({ type: "error", message });
        return { ok: false, content: message, events, usage, error: message };
    } catch (error: unknown) {
        const message: string = error instanceof Error ? error.message : "模型或工具执行失败";
        push({ type: "error", message });
        return { ok: false, content: message, events, usage, error: message };
    }
}
