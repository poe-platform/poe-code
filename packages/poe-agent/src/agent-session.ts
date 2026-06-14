import type {
  SessionUpdate,
  SpawnMode,
  ToolCall as AcpToolCall,
  ToolCallUpdate as AcpToolCallUpdate
} from "@poe-code/agent-spawn";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
import {
  createFileAwarenessTracker,
  recordToolFileAwareness
} from "./runtime/file-awareness.js";
import type { AgentPlugin } from "./runtime/plugin-types.js";
import type { SessionEntry } from "./runtime/session/entry-types.js";
import {
  createJsonlSessionStore,
  createMemorySessionStore,
  type SessionStore
} from "./runtime/session/session-store.js";
import { buildMessages, collectBranch, findHead } from "./runtime/session/session-tree.js";
import { getStructuredToolResultParts } from "./runtime/tool-results.js";
import type { AcpEvent, ChatMessage, RunResult } from "./runtime/types.js";

export interface AgentSession {
  readonly id: string;
  sendMessage(prompt: string, options?: AgentSessionSendMessageOptions): Promise<ChatMessage>;
  getHistory(): ChatMessage[];
  tree(): SessionEntry[];
  fork(fromEntryId: string): Promise<AgentSession>;
  navigateTo(entryId: string): Promise<void>;
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
  persist?: { directory: string };
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

  return await adaptAcpToLegacySession(builder, options);
}

async function adaptAcpToLegacySession(
  builder: AgentBuilder,
  options: CreateAgentSessionOptions,
  initialStore?: SessionStore,
  initialHeadId?: string | null
): Promise<AgentSession> {
  let disposed = false;
  let previousRun: Pick<RunResult, "messages"> | undefined = options.resume;
  let activeSession: Awaited<ReturnType<AgentBuilder["acp"]>> | undefined;
  const store = initialStore ?? (await createStore(options));
  let entries = await store.list();
  let headId = initialHeadId === undefined ? findHead(entries) : initialHeadId;
  if (entries.length === 0 && options.resume?.messages) {
    for (const entry of entriesFromMessages(options.resume.messages, headId)) {
      await store.append(entry);
      entries = [...entries, entry];
      headId = entry.id;
    }
  }
  const fileAwareness = createFileAwarenessTracker(options.cwd ?? process.cwd());
  const toolIntents = new Map<string, { tool: string; args: unknown }>();
  const recordedCompactionSummaries = new Set(
    entries
      .filter((entry): entry is Extract<SessionEntry, { kind: "compaction" }> =>
        entry.kind === "compaction"
      )
      .map((entry) => entry.summary)
  );

  return {
    id: store.sessionId,

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
      let userEntryRecorded = false;
      const treeResume = buildResumeFromTree(entries, headId);
      const recordSubmittedPrompt = async (submittedPrompt: string): Promise<void> => {
        if (userEntryRecorded) {
          return;
        }

        await appendEntry({
          kind: "user",
          text: submittedPrompt
        });
        userEntryRecorded = true;
      };

      const runOptions: LegacyAcpRunOptions = {
        signal: sendOptions.signal,
        resume: treeResume ?? previousRun,
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        fetch: options.fetch,
        cwd: options.cwd,
        env: options.env,
        maxIterations: options.maxToolCallIterations,
        fileAwareness,
        onPromptSubmitted: recordSubmittedPrompt,
        __legacyAutoHandleTools: true
      };

      const acpSession = await builder.acp(prompt, runOptions);
      activeSession = acpSession;
      if (disposed) {
        await acpSession.dispose();
        throw new Error("Agent session is already disposed.");
      }

      try {
        for await (const event of acpSession.events) {
          await recordSubmittedPrompt(prompt);
          await recordSessionEvent(event);
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
      await appendEntry({
        kind: "assistant",
        text: assistantContent
      });

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

    tree(): SessionEntry[] {
      return entries.map(cloneSessionEntry);
    },

    async fork(fromEntryId: string): Promise<AgentSession> {
      entries = await store.list();
      const branch = collectBranch(entries, fromEntryId);
      if (branch.length === 0 || branch.at(-1)?.id !== fromEntryId) {
        throw new Error(`Cannot fork unknown session entry: ${fromEntryId}`);
      }

      const forkStore = await createStore(options);
      for (const entry of branch) {
        await forkStore.append(entry);
      }
      const forkMarker = createEntry(
        {
          kind: "fork_marker",
          fromEntryId
        },
        fromEntryId
      );
      await forkStore.append(forkMarker);

      const branchSummary = createEntry(
        {
          kind: "branch_summary",
          fromEntryId,
          summary: `Forked into session ${forkStore.sessionId}.`
        },
        fromEntryId
      );
      await store.append(branchSummary);
      entries = await store.list();

      return await adaptAcpToLegacySession(builder, options, forkStore, forkMarker.id);
    },

    async navigateTo(entryId: string): Promise<void> {
      entries = await store.list();
      if (!entries.some((entry) => entry.id === entryId)) {
        throw new Error(`Cannot navigate to unknown session entry: ${entryId}`);
      }
      headId = entryId;
      previousRun = { messages: buildMessages(entries, headId) };
    },

    async dispose(): Promise<void> {
      disposed = true;
      previousRun = undefined;
      await activeSession?.dispose();
      await store.dispose();
    }
  };

  async function appendEntry(entry: NewSessionEntry): Promise<SessionEntry> {
    const persisted = createEntry(entry, headId);
    await store.append(persisted);
    headId = persisted.id;
    entries = [...entries, persisted];
    return persisted;
  }

  async function recordSessionEvent(event: AcpEvent): Promise<void> {
    if (event.type === "tool.intent") {
      toolIntents.set(event.intentId, {
        tool: event.tool,
        args: event.args
      });
      await appendEntry({
        kind: "tool_call",
        tool: event.tool,
        args: event.args,
        intentId: event.intentId
      });
      return;
    }

    if (event.type === "tool.result") {
      const intent = toolIntents.get(event.intentId);
      if (intent) {
        recordToolFileAwareness({
          tracker: fileAwareness,
          tool: intent.tool,
          args: intent.args
        });
      }
      await appendEntry({
        kind: "tool_result",
        intentId: event.intentId,
        result: event.result
      });
      return;
    }

    if (event.type === "tool.error") {
      await appendEntry({
        kind: "tool_result",
        intentId: event.intentId,
        error: event.error
      });
      return;
    }

    if (event.type === "session.complete") {
      for (const message of event.result.messages) {
        const summary = getCompactionSummary(message);
        if (summary === undefined || recordedCompactionSummaries.has(summary)) {
          continue;
        }

        const awareness = fileAwareness.snapshot();
        await appendEntry({
          kind: "compaction",
          summary,
          droppedIds: [],
          readFiles: Array.from(awareness.readFiles),
          modifiedFiles: Array.from(awareness.modifiedFiles)
        });
        recordedCompactionSummaries.add(summary);
      }
    }
  }
}

function cloneSessionEntry(entry: SessionEntry): SessionEntry {
  return JSON.parse(JSON.stringify(entry)) as SessionEntry;
}

type NewSessionEntry =
  | Omit<Extract<SessionEntry, { kind: "user" }>, "id" | "parentId" | "createdAt">
  | Omit<Extract<SessionEntry, { kind: "assistant" }>, "id" | "parentId" | "createdAt">
  | Omit<Extract<SessionEntry, { kind: "tool_call" }>, "id" | "parentId" | "createdAt">
  | Omit<Extract<SessionEntry, { kind: "tool_result" }>, "id" | "parentId" | "createdAt">
  | Omit<Extract<SessionEntry, { kind: "compaction" }>, "id" | "parentId" | "createdAt">
  | Omit<Extract<SessionEntry, { kind: "fork_marker" }>, "id" | "parentId" | "createdAt">
  | Omit<Extract<SessionEntry, { kind: "branch_summary" }>, "id" | "parentId" | "createdAt">;

async function createStore(options: CreateAgentSessionOptions): Promise<SessionStore> {
  const sessionId = randomUUID();
  if (!options.persist) {
    return createMemorySessionStore(sessionId);
  }

  return await createJsonlSessionStore(sessionId, expandHome(options.persist.directory));
}

function createEntry(entry: NewSessionEntry, parentId: string | null): SessionEntry {
  return {
    ...entry,
    id: randomUUID(),
    parentId,
    createdAt: new Date().toISOString()
  } as SessionEntry;
}

function buildResumeFromTree(
  entries: SessionEntry[],
  headId: string | null
): Pick<RunResult, "messages"> | undefined {
  if (entries.length === 0 || headId === null) {
    return undefined;
  }

  return { messages: buildMessages(entries, headId) };
}

function expandHome(directory: string): string {
  if (directory === "~") {
    return os.homedir();
  }

  if (directory.startsWith("~/")) {
    return path.join(os.homedir(), directory.slice(2));
  }

  return directory;
}

function getCompactionSummary(message: ChatMessage): string | undefined {
  if (message.role !== "system" || message.name !== "compaction") {
    return undefined;
  }

  if (typeof message.content !== "string") {
    return undefined;
  }

  return message.content.replace(/^Compacted context summary:\n/, "");
}

function entriesFromMessages(messages: ChatMessage[], initialParentId: string | null): SessionEntry[] {
  let parentId = initialParentId;
  const entries: SessionEntry[] = [];

  for (const message of messages) {
    const entry = entryFromMessage(message, parentId);
    if (!entry) {
      continue;
    }

    entries.push(entry);
    parentId = entry.id;
  }

  return entries;
}

function entryFromMessage(message: ChatMessage, parentId: string | null): SessionEntry | undefined {
  if (message.role === "user" && typeof message.content === "string") {
    return createEntry({ kind: "user", text: message.content }, parentId);
  }

  if (message.role === "assistant" && typeof message.content === "string") {
    return createEntry({ kind: "assistant", text: message.content }, parentId);
  }

  const compactionSummary = getCompactionSummary(message);
  if (compactionSummary !== undefined) {
    return createEntry(
      {
        kind: "compaction",
        summary: compactionSummary,
        droppedIds: [],
        readFiles: [],
        modifiedFiles: []
      },
      parentId
    );
  }

  if (message.role === "tool" && message.toolCallId) {
    return createEntry(
      {
        kind: "tool_result",
        intentId: message.toolCallId,
        result: message.content
      },
      parentId
    );
  }

  return undefined;
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
