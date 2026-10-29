export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface LlmToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}

export interface LlmChatMessage {
    role: ChatRole;
    content: string | null;
    tool_calls?: LlmToolCall[];
    tool_call_id?: string;
    name?: string;
}

export interface LlmToolDefinition {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface LlmUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

export interface LlmProviderResult {
    content: string;
    toolCalls: LlmToolCall[];
    usage?: LlmUsage;
}

export interface LlmSettings {
    baseUrl: string;
    model: string;
    apiKey: string;
    workspaceRoot: string;
}

export interface LlmPublicSettings {
    baseUrl: string;
    model: string;
    workspaceRoot: string;
    hasKey: boolean;
}

export interface LlmSaveSettings {
    baseUrl: string;
    model: string;
    apiKey: string;
    workspaceRoot: string;
}

export interface LlmChatRequest {
    messages: LlmChatMessage[];
}

export interface LlmChatResult {
    ok: boolean;
    content: string;
    usage?: LlmUsage;
    error?: string;
}

export interface LlmApi {
    getSettings: () => Promise<LlmPublicSettings>;
    saveSettings: (settings: LlmSaveSettings) => Promise<LlmPublicSettings>;
    clearApiKey: () => Promise<LlmPublicSettings>;
    chat: (request: LlmChatRequest) => Promise<LlmChatResult>;
}

export interface AgentRunRequest {
    prompt: string;
    history?: LlmChatMessage[];
}

export type AgentEvent =
    | {
        type: "assistant";
        content: string;
    }
    | {
        type: "tool_call";
        id: string;
        name: string;
        arguments: string;
    }
    | {
        type: "tool_result";
        id: string;
        name: string;
        ok: boolean;
        output: string;
        durationMs: number;
    }
    | {
        type: "error";
        message: string;
    }
    | {
        type: "final";
        content: string;
        usage?: LlmUsage;
    };

export interface AgentRunResult {
    ok: boolean;
    content: string;
    events: AgentEvent[];
    usage?: LlmUsage;
    error?: string;
}

export interface WorkspaceInfo {
    root: string;
    branch: string;
    files: string[];
    gitStatus: string;
    hasGit: boolean;
}

export interface AgentApi {
    run: (request: AgentRunRequest) => Promise<AgentRunResult>;
    onEvent: (callback: (event: AgentEvent) => void) => () => void;
    workspace: () => Promise<WorkspaceInfo>;
    pickDirectory: () => Promise<string | null>;
}

export interface ToolExecutionResult {
    ok: boolean;
    output: string;
}
