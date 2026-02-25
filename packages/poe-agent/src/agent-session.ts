import { createAuthStore } from "@poe-code/auth";
import type {
  SessionUpdate,
  ToolCall as AcpToolCall,
  ToolCallUpdate as AcpToolCallUpdate,
} from "@poe-code/agent-spawn";
import {
  PoeChatService,
  type ChatMessage,
  type PoeChatServiceOptions,
  type ToolCallLifecycleEvent,
} from "./chat.js";
import { loadSystemPrompt } from "./system-prompt.js";
import { DefaultToolExecutor } from "./tool-executor.js";

export interface AgentSession {
  sendMessage(prompt: string, options?: AgentSessionSendMessageOptions): Promise<ChatMessage>;
  dispose(): Promise<void>;
}

export interface AgentSessionSendMessageOptions {
  signal?: AbortSignal;
  onSessionUpdate?: SessionUpdateCallback;
}

export type SessionUpdateCallback = (update: SessionUpdate) => void;

export interface CreateAgentSessionOptions {
  model?: string;
  apiKey?: string;
  cwd?: string;
  allowedPaths?: string[];
  baseUrl?: string;
  fetch?: PoeChatServiceOptions["fetch"];
  maxToolCallIterations?: number;
}

type Disposable = {
  dispose(): Promise<void> | void;
};

export async function createAgentSession(
  options: CreateAgentSessionOptions = {},
): Promise<AgentSession> {
  const model = resolveRequiredModel(options.model);
  const apiKey = await resolveApiKey(options.apiKey);
  const systemPrompt = await loadSystemPrompt();

  const toolExecutor = new DefaultToolExecutor({
    cwd: options.cwd,
    allowedPaths: options.allowedPaths,
  });
  const tools = toolExecutor.getAvailableTools();

  let currentOnSessionUpdate: SessionUpdateCallback | undefined;

  const chatService = new PoeChatService({
    apiKey,
    model,
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    systemPrompt,
    toolExecutor,
    maxToolCallIterations: options.maxToolCallIterations,
    onToolCall: event => {
      if (!currentOnSessionUpdate) return;
      for (const update of mapToolLifecycleEventToSessionUpdates(event)) {
        currentOnSessionUpdate(update);
      }
    },
  });

  let disposed = false;

  return {
    async sendMessage(prompt: string, sendOptions?: AgentSessionSendMessageOptions): Promise<ChatMessage> {
      if (disposed) {
        throw new Error("Agent session is already disposed.");
      }

      currentOnSessionUpdate = sendOptions?.onSessionUpdate;

      const response = await chatService.sendMessage(prompt, {
        tools,
        signal: sendOptions?.signal,
      });

      if (currentOnSessionUpdate && response.role === "assistant" && response.content.length > 0) {
        currentOnSessionUpdate({
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: response.content,
          },
        });
      }

      return response;
    },

    async dispose(): Promise<void> {
      if (disposed) {
        return;
      }

      disposed = true;
      chatService.clearConversationHistory();

      const disposableToolExecutor = toolExecutor as unknown as Partial<Disposable>;
      if (typeof disposableToolExecutor.dispose === "function") {
        await disposableToolExecutor.dispose();
      }
    },
  };
}

async function resolveApiKey(explicitApiKey: string | undefined): Promise<string> {
  const normalizedExplicitApiKey = normalizeNonEmptyString(explicitApiKey);
  if (normalizedExplicitApiKey) {
    return normalizedExplicitApiKey;
  }

  const { store } = createAuthStore();
  const storedApiKey = normalizeNonEmptyString(await store.getApiKey());
  if (storedApiKey) {
    return storedApiKey;
  }

  throw new Error("Missing Poe API key. Provide apiKey or run 'poe-code login'.");
}

function resolveRequiredModel(model: string | undefined): string {
  const normalizedModel = normalizeNonEmptyString(model);
  if (normalizedModel) {
    return normalizedModel;
  }

  throw new Error("Missing model. Provide a non-empty model to createAgentSession.");
}

function normalizeNonEmptyString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function mapToolLifecycleEventToSessionUpdates(event: ToolCallLifecycleEvent): SessionUpdate[] {
  if (event.phase === "started") {
    const toolCall: AcpToolCall = {
      sessionUpdate: "tool_call",
      toolCallId: event.toolCallId,
      title: event.toolName,
      kind: "execute",
      status: "pending",
      rawInput: event.args,
    };
    const inProgressUpdate: AcpToolCallUpdate = {
      sessionUpdate: "tool_call_update",
      toolCallId: event.toolCallId,
      kind: "execute",
      status: "in_progress",
    };

    return [toolCall, inProgressUpdate];
  }

  const terminalUpdate: AcpToolCallUpdate = {
    sessionUpdate: "tool_call_update",
    toolCallId: event.toolCallId,
    kind: "execute",
    status: event.phase === "completed" ? "completed" : "failed",
  };

  if (event.phase === "completed" && event.result !== undefined) {
    terminalUpdate.rawOutput = event.result;
  }

  if (event.phase === "failed" && event.error !== undefined) {
    terminalUpdate.rawOutput = event.error;
  }

  return [terminalUpdate];
}
