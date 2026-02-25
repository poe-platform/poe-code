export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: Tool[];
}

export interface ChatCompletionResponse {
  choices: Array<{
    message: ChatMessage;
  }>;
}

export interface ToolExecutor {
  executeTool(name: string, args: Record<string, unknown>): Promise<string>;
}

export type ToolCallPhase = "started" | "completed" | "failed";

export interface ToolCallLifecycleEvent {
  phase: ToolCallPhase;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
}

export type ToolCallCallback = (event: ToolCallLifecycleEvent) => void;

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface PoeChatServiceOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: FetchFn;
  systemPrompt?: string;
  toolExecutor?: ToolExecutor;
  onToolCall?: ToolCallCallback;
  maxToolCallIterations?: number;
}

export interface SendMessageOptions {
  tools?: Tool[];
  signal?: AbortSignal;
}

export class PoeChatService {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchFn: FetchFn;
  private readonly chatCompletionsUrl: string;
  private readonly toolExecutor?: ToolExecutor;
  private readonly maxToolCallIterations: number;
  private conversationHistory: ChatMessage[] = [];
  private readonly toolCallCallback?: ToolCallCallback;

  constructor(options: PoeChatServiceOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.chatCompletionsUrl = toChatCompletionsUrl(options.baseUrl ?? "https://api.poe.com");
    this.toolExecutor = options.toolExecutor;
    this.toolCallCallback = options.onToolCall;
    this.maxToolCallIterations = options.maxToolCallIterations ?? 100;

    if (options.systemPrompt) {
      this.conversationHistory.push({
        role: "system",
        content: options.systemPrompt,
      });
    }
  }

  clearConversationHistory(): void {
    this.conversationHistory = [];
  }

  async sendMessage(userMessage: string, options?: SendMessageOptions): Promise<ChatMessage> {
    this.conversationHistory.push({
      role: "user",
      content: userMessage,
    });

    let iterationCount = 0;
    while (iterationCount < this.maxToolCallIterations) {
      const response = await this.requestCompletion(options?.tools, options?.signal);
      const assistantMessage = response.choices[0]?.message;

      if (!assistantMessage) {
        throw new Error("Poe API response did not include an assistant message");
      }

      this.conversationHistory.push(assistantMessage);

      const hasToolCalls =
        assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0 && this.toolExecutor;

      if (!hasToolCalls) {
        return assistantMessage;
      }

      await this.executeToolCalls(assistantMessage.tool_calls as ToolCall[]);
      iterationCount += 1;
    }

    throw new Error("Maximum tool call iterations reached");
  }

  private async requestCompletion(tools?: Tool[], signal?: AbortSignal): Promise<ChatCompletionResponse> {
    const requestBody: ChatCompletionRequest = {
      model: this.model,
      messages: this.conversationHistory,
    };

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    const response = await this.fetchFn(this.chatCompletionsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const errorBody = await readResponseText(response);
      const details = errorBody || response.statusText || "Unknown error";
      throw new Error(`Poe API request failed (${response.status}): ${details}`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    if (!Array.isArray(payload.choices)) {
      throw new Error("Poe API response had invalid choices payload");
    }

    return payload;
  }

  private async executeToolCalls(toolCalls: ToolCall[]): Promise<void> {
    if (!this.toolExecutor) {
      return;
    }

    for (const toolCall of toolCalls) {
      let args: Record<string, unknown> = {};

      try {
        args = parseToolArguments(toolCall.function.arguments);
        this.emitToolCallEvent({
          phase: "started",
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          args,
        });

        const result = await this.toolExecutor.executeTool(toolCall.function.name, args);
        this.emitToolCallEvent({
          phase: "completed",
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          args,
          result,
        });

        this.conversationHistory.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: result,
        });
      } catch (error) {
        const message = getErrorMessage(error);
        this.emitToolCallEvent({
          phase: "failed",
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          args,
          error: message,
        });

        this.conversationHistory.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: `Error: ${message}`,
        });
      }
    }
  }

  private emitToolCallEvent(event: ToolCallLifecycleEvent): void {
    if (this.toolCallCallback) {
      this.toolCallCallback(event);
    }
  }
}

function toChatCompletionsUrl(baseUrl: string): string {
  const trimmedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

  if (trimmedBaseUrl.endsWith("/v1")) {
    return `${trimmedBaseUrl}/chat/completions`;
  }

  return `${trimmedBaseUrl}/v1/chat/completions`;
}

function parseToolArguments(rawArguments: string): Record<string, unknown> {
  const parsed = JSON.parse(rawArguments) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool call arguments must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

async function readResponseText(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.trim() || undefined;
  } catch {
    return undefined;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

