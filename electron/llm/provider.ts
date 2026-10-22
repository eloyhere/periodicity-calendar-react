import type {
    LlmChatMessage,
    LlmProviderResult,
    LlmSettings,
    LlmToolCall,
    LlmToolDefinition,
    LlmUsage,
} from "./types";

interface ProviderMessage {
    content?: string | null;
    tool_calls?: LlmToolCall[];
}

interface ProviderChoice {
    message?: ProviderMessage;
}

interface ProviderPayload {
    choices?: ProviderChoice[];
    usage?: LlmUsage;
    error?: {
        message?: string;
    };
}

function providerUrl(baseUrl: string): string {
    const trimmed: string = baseUrl.trim().replace(/\/+$/, "");
    if (trimmed.endsWith("/chat/completions")) {
        return trimmed;
    }
    return `${trimmed}/chat/completions`;
}

function extractErrorMessage(text: string, status: number): string {
    try {
        const payload: ProviderPayload = JSON.parse(text) as ProviderPayload;
        if (payload.error?.message) {
            return `模型请求失败 (${String(status)}): ${payload.error.message}`;
        }
    } catch {
        // Fall back to raw text.
    }
    return `模型请求失败 (${String(status)}): ${text.slice(0, 600)}`;
}

export async function callModel(
    settings: LlmSettings,
    messages: LlmChatMessage[],
    tools?: LlmToolDefinition[],
): Promise<LlmProviderResult> {
    if (settings.apiKey.length === 0) {
        throw new Error("未配置模型 API Key。请在设置中填写。");
    }
    const controller: AbortController = new AbortController();
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
        controller.abort();
    }, 120000);
    try {
        const body: Record<string, unknown> = {
            model: settings.model,
            messages,
            temperature: 0.2,
        };
        if (tools && tools.length > 0) {
            body.tools = tools;
            body.tool_choice = "auto";
        }
        const response: Response = await fetch(providerUrl(settings.baseUrl), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${settings.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const text: string = await response.text();
        if (!response.ok) {
            throw new Error(extractErrorMessage(text, response.status));
        }
        const payload: ProviderPayload = JSON.parse(text) as ProviderPayload;
        const choice: ProviderChoice | undefined = payload.choices?.[0];
        const message: ProviderMessage | undefined = choice?.message;
        if (!message) {
            throw new Error("模型响应缺少 choices[0].message");
        }
        return {
            content: message.content ?? "",
            toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
            usage: payload.usage,
        };
    } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
            throw new Error("模型请求超时（120s）");
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}
