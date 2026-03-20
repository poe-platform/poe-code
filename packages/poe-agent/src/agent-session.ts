import type {
  SessionUpdate,
  ToolCall as AcpToolCall,
  ToolCallUpdate as AcpToolCallUpdate,
} from "@poe-code/agent-spawn";
import { HttpTransport, McpClient, StdioTransport, type Tool as McpTool } from "tiny-mcp-client";
import { agent, type AgentBuilder, type AgentRunOptions } from "./agent.js";
import {
  callToolResultToString,
  namespaceMcpToolName,
  type McpServerDefinition,
} from "./mcp-tool-executor.js";
import filesPlugin from "./plugins/poe-agent-plugin-files.js";
import shellPlugin from "./plugins/poe-agent-plugin-shell.js";
import systemPromptPlugin from "./plugins/poe-agent-plugin-system-prompt.js";
import webPlugin from "./plugins/poe-agent-plugin-web.js";
import type { AgentPlugin } from "./runtime/plugin-types.js";
import type { AcpEvent, RunResult, Tool } from "./runtime/types.js";

type ChatMessage = { role: string; content: string };

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
  fetch?: AgentRunOptions["fetch"];
  maxToolCallIterations?: number;
}

type LegacyAcpRunOptions = AgentRunOptions & {
  __legacyAutoHandleTools: true;
};

export async function createAgentSession(
  options: CreateAgentSessionOptions = {},
): Promise<AgentSession> {
  const builder = agent()
    .model(resolveRequiredModel(options.model))
    .use(systemPromptPlugin())
    .use(fileTools(options))
    .use(shellTools(options))
    .use(webTools())
    .use(mcpPluginFromOptions(options));

  return adaptAcpToLegacySession(builder, options);
}

function fileTools(options: CreateAgentSessionOptions): AgentPlugin {
  return filesPlugin({
    cwd: options.cwd,
    allowedPaths: options.allowedPaths,
  });
}

function shellTools(options: CreateAgentSessionOptions): AgentPlugin {
  return shellPlugin({
    cwd: options.cwd,
    allowedPaths: options.allowedPaths,
  });
}

function webTools(): AgentPlugin {
  return webPlugin();
}

function mcpPluginFromOptions(options: CreateAgentSessionOptions): AgentPlugin {
  const servers = options.mcpServers ? Object.entries(options.mcpServers) : [];
  const connectedClients = new Set<McpClient>();

  return {
    name: "poe-agent-plugin-mcp",
    async setup(api) {
      if (servers.length === 0) {
        return;
      }

      const initializedClients: McpClient[] = [];

      try {
        for (const [serverName, definition] of servers) {
          const client = new McpClient({
            clientInfo: {
              name: "poe-agent",
              version: "0.0.1",
            },
          });

          await client.connect(createMcpTransport(definition));
          initializedClients.push(client);
          connectedClients.add(client);

          await registerMcpTools(api.addTool.bind(api), serverName, client);
        }
      } catch (error) {
        await closeMcpClients(initializedClients);

        for (const client of initializedClients) {
          connectedClients.delete(client);
        }

        throw error;
      }
    },
    async dispose() {
      const clients = Array.from(connectedClients);
      connectedClients.clear();
      await closeMcpClients(clients);
    },
  };
}

async function registerMcpTools(
  addTool: (tool: Tool) => void,
  serverName: string,
  client: McpClient,
): Promise<void> {
  let cursor: string | undefined;

  while (true) {
    const page = cursor === undefined ? await client.listTools() : await client.listTools({ cursor });

    for (const mcpTool of page.tools) {
      addTool(mcpToolToRuntimeTool(serverName, mcpTool, client));
    }

    if (page.nextCursor === undefined) {
      return;
    }

    cursor = page.nextCursor;
  }
}

function mcpToolToRuntimeTool(serverName: string, mcpTool: McpTool, client: McpClient): Tool {
  return {
    name: namespaceMcpToolName(serverName, mcpTool.name),
    description: mcpTool.description,
    inputSchema: mcpTool.inputSchema,
    async call(args, ctx) {
      const result = await client.callTool(
        {
          name: mcpTool.name,
          arguments: toMcpArguments(args),
        },
        { signal: ctx.signal },
      );

      return callToolResultToString(result);
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

function toMcpArguments(args: unknown): Record<string, unknown> | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return undefined;
  }

  return args as Record<string, unknown>;
}

async function closeMcpClients(clients: McpClient[]): Promise<void> {
  await Promise.allSettled(clients.map(async client => {
    await client.close?.();
  }));
}

function adaptAcpToLegacySession(
  builder: AgentBuilder,
  options: CreateAgentSessionOptions,
): AgentSession {
  let disposed = false;
  let previousRun: RunResult | undefined;

  return {
    async sendMessage(prompt: string, sendOptions: AgentSessionSendMessageOptions = {}): Promise<ChatMessage> {
      if (disposed) {
        throw new Error("Agent session is already disposed.");
      }

      const onSessionUpdate = sendOptions.onSessionUpdate;
      let assistantContent = "";
      let emittedAssistantChunk = false;
      let completed: RunResult | undefined;
      let failed: Error | undefined;

      const runOptions: LegacyAcpRunOptions = {
        signal: sendOptions.signal,
        resume: previousRun,
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        fetch: options.fetch,
        cwd: options.cwd,
        maxIterations: options.maxToolCallIterations,
        __legacyAutoHandleTools: true,
      };

      const acpSession = await builder.acp(prompt, runOptions);

      try {
        for await (const event of acpSession.events) {
          handleEvent(event, onSessionUpdate, chunk => {
            if (chunk.length > 0) {
              emittedAssistantChunk = true;
              assistantContent += chunk;
            }
          });

          if (event.type === "session.complete") {
            completed = event.result;
            assistantContent = event.result.output;
            continue;
          }

          if (event.type === "session.error") {
            failed = event.error;
          }
        }
      } finally {
        await acpSession.dispose();
      }

      if (failed) {
        throw failed;
      }

      if (!completed) {
        throw new Error("Run ended without a terminal event.");
      }

      previousRun = completed;

      if (onSessionUpdate && !emittedAssistantChunk && assistantContent.length > 0) {
        onSessionUpdate({
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: assistantContent,
          },
        });
      }

      return {
        role: "assistant",
        content: assistantContent,
      };
    },

    async dispose(): Promise<void> {
      disposed = true;
      previousRun = undefined;
    },
  };
}

function handleEvent(
  event: AcpEvent,
  onSessionUpdate: SessionUpdateCallback | undefined,
  onMessageDelta: (chunk: string) => void,
): void {
  if (event.type === "tool.intent") {
    if (!onSessionUpdate) {
      return;
    }

    const toolCall: AcpToolCall = {
      sessionUpdate: "tool_call",
      toolCallId: event.intentId,
      title: event.tool,
      kind: "execute",
      status: "pending",
      rawInput: event.args,
    };

    const inProgressUpdate: AcpToolCallUpdate = {
      sessionUpdate: "tool_call_update",
      toolCallId: event.intentId,
      kind: "execute",
      status: "in_progress",
    };

    onSessionUpdate(toolCall);
    onSessionUpdate(inProgressUpdate);
    return;
  }

  if (event.type === "tool.result") {
    if (!onSessionUpdate) {
      return;
    }

    onSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: event.intentId,
      kind: "execute",
      status: "completed",
      rawOutput: event.result,
    });
    return;
  }

  if (event.type === "tool.error") {
    if (!onSessionUpdate) {
      return;
    }

    onSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: event.intentId,
      kind: "execute",
      status: "failed",
      rawOutput: event.error,
    });
    return;
  }

  if (event.type === "message.delta") {
    onMessageDelta(event.content);

    if (!onSessionUpdate || event.content.length === 0) {
      return;
    }

    onSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: event.content,
      },
    });
  }
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
