import type {
  SessionUpdate,
  SpawnMode,
  ToolCall as AcpToolCall,
  ToolCallUpdate as AcpToolCallUpdate
} from "@poe-code/agent-spawn";
import {
  agent,
  normalizeNonEmptyString,
  type AgentBuilder,
  type AgentRunOptions
} from "./agent.js";
import filesPlugin from "./plugins/poe-agent-plugin-files.js";
import { openaiChatCompletionsPlugin } from "./plugins/poe-agent-plugin-openai-chat-completions.js";
import { openaiResponsesPlugin } from "./plugins/poe-agent-plugin-openai-responses.js";
import policyPlugin from "./plugins/poe-agent-plugin-policy.js";
import shellPlugin from "./plugins/poe-agent-plugin-shell.js";
import systemPromptPlugin from "./plugins/poe-agent-plugin-system-prompt.js";
import webPlugin from "./plugins/poe-agent-plugin-web.js";
import { resolvePluginsFromConfig, type PluginConfigEntry } from "./plugins/resolve-plugins.js";
import type { AgentPlugin } from "./runtime/plugin-types.js";
import { getStructuredToolResultParts } from "./runtime/tool-results.js";
import type { AcpEvent, ChatMessage, RunResult } from "./runtime/types.js";

export interface AgentSession {
  sendMessage(prompt: string, options?: AgentSessionSendMessageOptions): Promise<ChatMessage>;
  getHistory(): ChatMessage[];
  dispose(): Promise<void>;
}

export interface AgentSessionSendMessageOptions {
  signal?: AbortSignal;
  onSessionUpdate?: SessionUpdateCallback;
}

export type SessionUpdateCallback = (update: SessionUpdate) => void;

export interface McpStdioServerDefinition {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpServerDefinition {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerDefinition = McpStdioServerDefinition | McpHttpServerDefinition;

export interface CreateAgentSessionOptions {
  model?: string;
  apiKey?: string;
  cwd?: string;
  allowedPaths?: string[];
  plugins?: AgentPlugin[];
  pluginsConfig?: PluginConfigEntry[];
  mcpServers?: Record<string, McpServerDefinition>;
  baseUrl?: string;
  fetch?: AgentRunOptions["fetch"];
  maxToolCallIterations?: number;
  mode?: SpawnMode;
  resume?: { messages: ChatMessage[] };
  env?: Record<string, string | undefined>;
}

type LegacyAcpRunOptions = AgentRunOptions & {
  __legacyAutoHandleTools: true;
};

export async function createAgentSession(
  options: CreateAgentSessionOptions = {}
): Promise<AgentSession> {
  const model = normalizeNonEmptyString(options.model);
  if (!model) {
    throw new Error("Missing model. Provide a non-empty model to createAgentSession.");
  }

  if (options.plugins && options.pluginsConfig) {
    throw new Error("Cannot provide both plugins and pluginsConfig.");
  }

  let builder = agent().model(model);
  const plugins = options.plugins ??
    (options.pluginsConfig !== undefined
      ? resolvePluginsFromConfig(options.pluginsConfig)
      : undefined) ?? [
      openaiResponsesPlugin(),
      openaiChatCompletionsPlugin(),
      systemPromptPlugin(),
      filesPlugin({ cwd: options.cwd, allowedPaths: options.allowedPaths }),
      shellPlugin({ cwd: options.cwd, allowedPaths: options.allowedPaths }),
      webPlugin()
    ];

  for (const plugin of plugins) {
    builder = builder.use(plugin);
  }

  for (const [name, definition] of Object.entries(options.mcpServers ?? {})) {
    if (definition.transport !== "stdio") {
      throw new Error(
        `Unsupported MCP transport "${definition.transport}" for server "${name}". Only "stdio" is supported.`
      );
    }

    builder = builder.mcp({
      name,
      command: definition.command,
      args: definition.args,
      env: definition.env
    });
  }

  const mode = options.mode;
  if (mode === "auto") {
    throw new Error('poe-agent does not support mode "auto". Supported modes: read, edit, yolo.');
  }
  if (mode) {
    builder = builder.use(policyPlugin({ mode }));
  }

  return adaptAcpToLegacySession(builder, options);
}

function adaptAcpToLegacySession(
  builder: AgentBuilder,
  options: CreateAgentSessionOptions
): AgentSession {
  let disposed = false;
  let previousRun: Pick<RunResult, "messages"> | undefined = options.resume;
  let activeSession: Awaited<ReturnType<AgentBuilder["acp"]>> | undefined;

  return {
    async sendMessage(
      prompt: string,
      sendOptions: AgentSessionSendMessageOptions = {}
    ): Promise<ChatMessage> {
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
        env: options.env,
        maxIterations: options.maxToolCallIterations,
        __legacyAutoHandleTools: true
      };

      const acpSession = await builder.acp(prompt, runOptions);
      activeSession = acpSession;

      try {
        for await (const event of acpSession.events) {
          handleEvent(event, onSessionUpdate, (chunk) => {
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
        if (activeSession === acpSession) {
          activeSession = undefined;
        }
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
            text: assistantContent
          }
        });
      }

      return {
        role: "assistant",
        content: assistantContent
      };
    },

    getHistory(): ChatMessage[] {
      return previousRun?.messages ?? [];
    },

    async dispose(): Promise<void> {
      disposed = true;
      previousRun = undefined;
      await activeSession?.dispose();
    }
  };
}

function handleEvent(
  event: AcpEvent,
  onSessionUpdate: SessionUpdateCallback | undefined,
  onMessageDelta: (chunk: string) => void
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
      rawInput: event.args
    };

    const inProgressUpdate: AcpToolCallUpdate = {
      sessionUpdate: "tool_call_update",
      toolCallId: event.intentId,
      kind: "execute",
      status: "in_progress"
    };

    onSessionUpdate(toolCall);
    onSessionUpdate(inProgressUpdate);
    return;
  }

  if (event.type === "tool.result") {
    if (!onSessionUpdate) {
      return;
    }

    const content = toLegacyToolCallContent(event.result);
    onSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: event.intentId,
      kind: "execute",
      status: "completed",
      rawOutput: event.result,
      ...(content === undefined ? {} : { content })
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
      rawOutput: event.error
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
        text: event.content
      }
    });
    return;
  }

  if (event.type === "usage") {
    if (!onSessionUpdate) {
      return;
    }

    const { inputTokens, outputTokens, cachedTokens, cacheCreationTokens } = event.usage;
    const nonCachedInput = Math.max(0, inputTokens - cachedTokens);

    onSessionUpdate({
      sessionUpdate: "usage_update",
      used: nonCachedInput,
      size: inputTokens,
      _meta: {
        inputTokens,
        outputTokens,
        cachedTokens,
        cacheCreationTokens
      }
    });
  }
}

function toLegacyToolCallContent(result: unknown): AcpToolCallUpdate["content"] | undefined {
  const parts = getStructuredToolResultParts(result);
  if (!parts) {
    return undefined;
  }

  return parts.map((part) => {
    if (part.type === "text") {
      return {
        type: "text" as const,
        text: part.text
      };
    }

    if (part.type === "image") {
      return {
        type: "image" as const,
        mimeType: part.mimeType,
        data: part.data
      };
    }

    return {
      type: "text" as const,
      text: JSON.stringify(part)
    };
  });
}
