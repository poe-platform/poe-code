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
  type Tool,
  type ToolCallLifecycleEvent,
  type ToolExecutor,
} from "./chat.js";
import { HttpTransport, McpClient, StdioTransport } from "tiny-mcp-client";
import { McpToolExecutor, type McpServerDefinition } from "./mcp-tool-executor.js";
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
  mcpServers?: Record<string, McpServerDefinition>;
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
  const builtInTools = toolExecutor.getAvailableTools();
  const builtInToolNames = new Set(builtInTools.map(tool => tool.function.name));

  let tools: Tool[] = builtInTools;
  let chatToolExecutor: ToolExecutor = toolExecutor;
  let mcpToolExecutor: McpToolExecutor | undefined;

  if (options.mcpServers !== undefined) {
    const createdMcpToolExecutor = new McpToolExecutor();
    mcpToolExecutor = createdMcpToolExecutor;

    try {
      for (const [serverName, serverDefinition] of Object.entries(options.mcpServers)) {
        const mcpClient = new McpClient({
          clientInfo: {
            name: "poe-agent",
            version: "0.0.1",
          },
        });
        const transport = createMcpTransport(serverDefinition);

        await mcpClient.connect(transport);
        await createdMcpToolExecutor.addServer(serverName, mcpClient);
      }
    } catch (error) {
      await createdMcpToolExecutor.dispose();
      throw error;
    }

    const mcpTools = createdMcpToolExecutor.getAvailableTools();
    tools = [...builtInTools, ...mcpTools];
    chatToolExecutor = {
      executeTool(name: string, args: Record<string, unknown>): Promise<string> {
        if (builtInToolNames.has(name)) {
          return toolExecutor.executeTool(name, args);
        }

        return createdMcpToolExecutor.executeTool(name, args);
      },
    };
  }

  let currentOnSessionUpdate: SessionUpdateCallback | undefined;

  const chatService = new PoeChatService({
    apiKey,
    model,
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    systemPrompt,
    toolExecutor: chatToolExecutor,
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
      const disposePromises: Array<Promise<void>> = [];

      if (typeof disposableToolExecutor.dispose === "function") {
        disposePromises.push(Promise.resolve(disposableToolExecutor.dispose()));
      }

      if (mcpToolExecutor) {
        disposePromises.push(mcpToolExecutor.dispose());
      }

      if (disposePromises.length > 0) {
        await Promise.all(disposePromises);
      }
    },
  };
}

function createMcpTransport(server: McpServerDefinition): StdioTransport | HttpTransport {
  if (server.transport === "stdio") {
    return new StdioTransport({
      command: server.command,
      args: server.args,
      env: server.env,
    });
  }

  return new HttpTransport({
    url: server.url,
    headers: server.headers,
  });
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
