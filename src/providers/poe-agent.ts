import fsPromises from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type {
  AcpEvent,
  McpSpawnConfig,
  SpawnUsage,
  SessionUpdate as LegacySessionUpdate
} from "@poe-code/agent-spawn";
import {
  AcpClient,
  generateRunReportFromSessionUpdateStream,
  type AcpTransportClosedEvent,
  type ContentBlock,
  type InitializeResponse,
  type NewSessionResponse,
  type PromptResponse,
  type SessionNotification,
  type SessionUpdate,
  type SessionUpdateNotification,
  type ToolCallStatus,
  type ToolKind
} from "@poe-code/poe-acp-client";
import type { FileSystem as ConfigFileSystem } from "@poe-code/config-mutations";
import {
  createConfigStore,
  resolveConfigPath,
  resolveProjectConfigPath
} from "@poe-code/poe-code-config/core";
import {
  createAgentSessionStore,
  type ChatMessage,
  type PersistedAgentSession,
  type PluginConfigEntry
} from "@poe-code/poe-agent";
import { createProvider } from "./create-provider.js";
import { agentConfigScope } from "../services/config.js";
import type { EmptyProviderOptions } from "./spawn-options.js";

interface AgentSessionRuntime {
  sendMessage(
    prompt: string,
    options?: { onSessionUpdate?: (update: LegacySessionUpdate) => void }
  ): Promise<{ content: string }>;
  getHistory(): ChatMessage[];
  dispose(): Promise<void>;
}

interface EventQueue<T> extends AsyncIterable<T> {
  push(value: T): void;
  complete(): void;
}

interface PoeAgentLifecycleOptions {
  prompt: string;
  model?: string;
  cwd: string;
  mcpServers?: McpSpawnConfig;
  baseUrl?: string;
  homeDir?: string;
  configPath?: string;
  projectConfigPath?: string;
  fs?: Pick<ConfigFileSystem, "mkdir" | "readFile" | "writeFile">;
  resumeThreadId?: string;
  onEvent?: (event: AcpEvent) => void;
}

interface PoeAgentSpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  threadId?: string;
  usage?: SpawnUsage;
}

interface ToolRenderState {
  startedToolCalls: Set<string>;
  toolCallKinds: Map<string, string>;
  toolCallTitles: Map<string, string>;
}

interface InMemoryAcpTransport {
  closed: Promise<AcpTransportClosedEvent>;
  sendRequest<TResult = unknown>(method: string, params?: unknown): Promise<TResult>;
  sendNotification(method: string, params?: unknown): void;
  onRequest(
    method: string,
    handler: (params: unknown, context: { id: string | number | null; method: string }) => unknown
  ): void;
  onNotification(
    method: string,
    handler: (params: unknown, context: { method: string }) => void | Promise<void>
  ): void;
  dispose(reason?: Error): void;
}

function createEventQueue<T>(): EventQueue<T> {
  const values: T[] = [];
  const waiters: Array<(value: IteratorResult<T>) => void> = [];
  let completed = false;

  return {
    push(value: T): void {
      if (completed) {
        return;
      }

      const waiter = waiters.shift();
      if (waiter) {
        waiter({ done: false, value });
        return;
      }

      values.push(value);
    },
    complete(): void {
      if (completed) {
        return;
      }
      completed = true;
      while (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter?.({ done: true, value: undefined });
      }
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (values.length > 0) {
            const value = values.shift() as T;
            return Promise.resolve({ done: false, value });
          }

          if (completed) {
            return Promise.resolve({ done: true, value: undefined });
          }

          return new Promise<IteratorResult<T>>((resolve) => {
            waiters.push(resolve);
          });
        }
      };
    }
  };
}

function createToolRenderState(): ToolRenderState {
  return {
    startedToolCalls: new Set<string>(),
    toolCallKinds: new Map<string, string>(),
    toolCallTitles: new Map<string, string>()
  };
}

function toAgentSessionMcpServers(servers: McpSpawnConfig):
  | Record<
      string,
      {
        transport: "stdio";
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }
    >
  | undefined {
  const mappedServers: Record<
    string,
    {
      transport: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  > = Object.create(null) as Record<
    string,
    {
      transport: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;

  for (const [name, server] of Object.entries(servers)) {
    mappedServers[name] = {
      transport: "stdio",
      command: server.command,
      ...(server.args && server.args.length > 0 ? { args: [...server.args] } : {}),
      ...(server.env && Object.keys(server.env).length > 0 ? { env: { ...server.env } } : {})
    };
  }

  return Object.keys(mappedServers).length > 0 ? mappedServers : undefined;
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  return String(value);
}

function toErrorStack(value: unknown): string | undefined {
  if (value instanceof Error && typeof value.stack === "string" && value.stack.length > 0) {
    return value.stack;
  }

  return undefined;
}

function mapLegacyToolKind(kind: unknown): ToolKind | undefined {
  if (kind === "read") {
    return "read";
  }

  if (kind === "execute") {
    return "execute";
  }

  if (kind === "edit" || kind === "delete" || kind === "move") {
    return "write";
  }

  if (
    kind === "other" ||
    kind === "search" ||
    kind === "think" ||
    kind === "fetch" ||
    kind === "switch_mode"
  ) {
    return "other";
  }

  return undefined;
}

function mapLegacyToolStatus(status: unknown): ToolCallStatus | undefined {
  if (
    status === "pending" ||
    status === "in_progress" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  ) {
    return status;
  }

  return undefined;
}

function normalizeSessionUpdate(update: LegacySessionUpdate): SessionUpdate {
  if (
    update.sessionUpdate === "agent_message_chunk" ||
    update.sessionUpdate === "agent_thought_chunk"
  ) {
    return {
      sessionUpdate: update.sessionUpdate,
      content: update.content
    };
  }

  if (update.sessionUpdate === "usage_update") {
    const normalized: SessionUpdate = {
      sessionUpdate: "usage_update",
      used: update.used,
      size: update.size
    };

    if (update.cost) {
      normalized.cost = update.cost;
    }

    if (update._meta !== undefined) {
      normalized._meta = update._meta;
    }

    return normalized;
  }

  if (update.sessionUpdate === "tool_call") {
    const normalized: SessionUpdate = {
      sessionUpdate: "tool_call",
      toolCallId: update.toolCallId,
      title: update.title
    };

    const kind = mapLegacyToolKind(update.kind);
    if (kind !== undefined) {
      normalized.kind = kind;
    }

    const status = mapLegacyToolStatus(update.status);
    if (status !== undefined) {
      normalized.status = status;
    }

    if (update.rawInput !== undefined) {
      normalized.rawInput = update.rawInput;
    }

    if (update._meta !== undefined) {
      normalized._meta = update._meta;
    }

    return normalized;
  }

  const normalized: SessionUpdate = {
    sessionUpdate: "tool_call_update",
    toolCallId: update.toolCallId
  };

  const kind = mapLegacyToolKind(update.kind);
  if (kind !== undefined) {
    normalized.kind = kind;
  }

  const status = mapLegacyToolStatus(update.status);
  if (status !== undefined) {
    normalized.status = status;
  }

  if (update.rawOutput !== undefined) {
    normalized.rawOutput = update.rawOutput;
  }

  if (update._meta !== undefined) {
    normalized._meta = update._meta;
  }

  return normalized;
}

function toRenderKind(kind: ToolKind | undefined): string {
  if (kind === "execute") {
    return "exec";
  }

  if (kind === "write") {
    return "edit";
  }

  if (kind === "read") {
    return "read";
  }

  return "other";
}

function toToolOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "";
  }

  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === "string") {
      return serialized;
    }
  } catch {
    // Fall through to String(value) if serialization fails.
  }

  return String(value);
}

function toPromptText(prompt: ContentBlock[]): string {
  const lines: string[] = [];

  for (const block of prompt) {
    if (block.type === "text") {
      lines.push(block.text);
      continue;
    }

    if (block.type === "resource_link") {
      lines.push(`${block.name}: ${block.uri}`);
      continue;
    }

    if (block.type === "resource") {
      if ("text" in block.resource) {
        lines.push(block.resource.text);
      }
      continue;
    }
  }

  return lines.join("\n");
}

function toEventsFromSessionUpdate(
  notification: SessionUpdateNotification,
  state: ToolRenderState
): AcpEvent[] {
  const update = notification.params.update;

  if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
    return [{ event: "agent_message", text: update.content.text }];
  }

  if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text") {
    return [{ event: "reasoning", text: update.content.text }];
  }

  if (update.sessionUpdate === "usage_update") {
    const meta = (update._meta ?? {}) as {
      inputTokens?: number;
      outputTokens?: number;
      cachedTokens?: number;
    };
    const inputTokens = typeof meta.inputTokens === "number" ? meta.inputTokens : update.used;
    const outputTokens = typeof meta.outputTokens === "number" ? meta.outputTokens : 0;
    const cachedTokens =
      typeof meta.cachedTokens === "number"
        ? meta.cachedTokens
        : Math.max(0, update.size - update.used);

    const usage: AcpEvent = {
      event: "usage",
      inputTokens,
      outputTokens
    };

    if (cachedTokens > 0) {
      usage.cachedTokens = cachedTokens;
    }

    if (update.cost && update.cost.currency === "USD") {
      usage.costUsd = update.cost.amount;
    }

    return [usage];
  }

  if (update.sessionUpdate === "tool_call") {
    const renderKind = toRenderKind(update.kind);
    state.toolCallKinds.set(update.toolCallId, renderKind);
    state.toolCallTitles.set(update.toolCallId, update.title);

    if (state.startedToolCalls.has(update.toolCallId)) {
      return [];
    }

    state.startedToolCalls.add(update.toolCallId);
    return [
      {
        event: "tool_start",
        kind: renderKind,
        title: update.title,
        id: update.toolCallId
      }
    ];
  }

  if (update.sessionUpdate === "tool_call_update") {
    const renderKind =
      toRenderKind(update.kind ?? undefined) ||
      state.toolCallKinds.get(update.toolCallId) ||
      "other";
    state.toolCallKinds.set(update.toolCallId, renderKind);

    const events: AcpEvent[] = [];
    const toolTitle = state.toolCallTitles.get(update.toolCallId) ?? update.toolCallId;
    const status = update.status;

    const shouldStart =
      !state.startedToolCalls.has(update.toolCallId) &&
      (status === "pending" || status === "in_progress");
    if (shouldStart) {
      state.startedToolCalls.add(update.toolCallId);
      events.push({
        event: "tool_start",
        kind: renderKind,
        title: toolTitle,
        id: update.toolCallId
      });
    }

    if (status === "completed" || status === "failed" || status === "cancelled") {
      if (!state.startedToolCalls.has(update.toolCallId)) {
        state.startedToolCalls.add(update.toolCallId);
        events.push({
          event: "tool_start",
          kind: renderKind,
          title: toolTitle,
          id: update.toolCallId
        });
      }

      events.push({
        event: "tool_complete",
        kind: renderKind,
        path: toToolOutput(update.rawOutput),
        id: update.toolCallId
      });
    }

    return events;
  }

  return [];
}

function emitEvent(callback: ((event: AcpEvent) => void) | undefined, event: AcpEvent): void {
  if (!callback) {
    return;
  }

  callback(event);
}

async function loadConfiguredPlugins(
  options: Pick<
    PoeAgentLifecycleOptions,
    "cwd" | "homeDir" | "configPath" | "projectConfigPath" | "fs"
  >
): Promise<PluginConfigEntry[] | undefined> {
  const fs = createConfigFileSystem(options.fs);
  const homeDir = options.homeDir ?? os.homedir();
  const store = createConfigStore({
    fs,
    filePath: options.configPath ?? resolveConfigPath(homeDir),
    projectFilePath: options.projectConfigPath ?? resolveProjectConfigPath(options.cwd)
  });
  const plugins = await store.scope(agentConfigScope).get("plugins");
  return plugins ?? undefined;
}

function createConfigFileSystem(
  fs: Pick<ConfigFileSystem, "mkdir" | "readFile" | "writeFile"> | undefined
): ConfigFileSystem {
  if (fs) {
    return fs as ConfigFileSystem;
  }

  return {
    readFile(filePath: string, encoding: "utf8"): Promise<string> {
      return fsPromises.readFile(filePath, encoding);
    },
    async writeFile(
      filePath: string,
      content: string,
      options?: { encoding: "utf8"; flag?: string }
    ): Promise<void> {
      await fsPromises.writeFile(filePath, content, options);
    },
    async mkdir(filePath: string, options?: { recursive: boolean }): Promise<void> {
      await fsPromises.mkdir(filePath, options);
    },
    rename(oldPath: string, newPath: string): Promise<void> {
      return fsPromises.rename(oldPath, newPath);
    },
    unlink(filePath: string): Promise<void> {
      return fsPromises.unlink(filePath);
    },
    stat(filePath: string): Promise<{ mode?: number }> {
      return fsPromises.stat(filePath);
    },
    lstat(filePath: string): Promise<{ isSymbolicLink(): boolean }> {
      return fsPromises.lstat(filePath);
    },
    readdir(filePath: string): Promise<string[]> {
      return fsPromises.readdir(filePath);
    },
    chmod(filePath: string, mode: number): Promise<void> {
      return fsPromises.chmod(filePath, mode);
    }
  };
}

function createInMemoryAcpTransport(options: {
  model: string;
  cwd: string;
  mcpServers?: McpSpawnConfig;
  baseUrl?: string;
  pluginsConfig?: PluginConfigEntry[];
  persistedSession?: PersistedAgentSession;
  saveSession(session: PersistedAgentSession): Promise<void>;
}): InMemoryAcpTransport {
  const sessions = new Map<string, AgentSessionRuntime>();
  const notificationHandlers = new Map<
    string,
    Array<(params: unknown, context: { method: string }) => void | Promise<void>>
  >();
  const requestHandlers = new Map<
    string,
    Array<(params: unknown, context: { id: string | number | null; method: string }) => unknown>
  >();

  let closed = false;
  let resolveClosed: ((event: AcpTransportClosedEvent) => void) | undefined;
  const closedPromise = new Promise<AcpTransportClosedEvent>((resolve) => {
    resolveClosed = resolve;
  });
  const sessionMcpServers = options.mcpServers
    ? toAgentSessionMcpServers(options.mcpServers)
    : undefined;

  const closeTransport = (reason: Error): void => {
    if (closed) {
      return;
    }

    closed = true;

    const entries = Array.from(sessions.values());
    sessions.clear();

    void Promise.all(
      entries.map(async (session) => {
        await session.dispose();
      })
    ).finally(() => {
      resolveClosed?.({
        code: 0,
        signal: null,
        reason,
        stderr: ""
      });
    });
  };

  return {
    closed: closedPromise,
    async sendRequest<TResult = unknown>(method: string, params?: unknown): Promise<TResult> {
      if (method === "initialize") {
        const request = params as { protocolVersion?: number };
        const response: InitializeResponse = {
          protocolVersion: request.protocolVersion ?? 1,
          agentInfo: { name: "poe-agent", version: "0.0.1" },
          agentCapabilities: {
            sessionCapabilities: {},
            promptCapabilities: {}
          }
        };
        return response as TResult;
      }

      if (method === "session/new") {
        const request = params as { cwd: string };
        const { createAgentSession } = await import("@poe-code/poe-agent");
        const session = await createAgentSession({
          model: options.model,
          cwd: request.cwd || options.cwd,
          ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
          ...(sessionMcpServers ? { mcpServers: sessionMcpServers } : {}),
          ...(options.pluginsConfig !== undefined ? { pluginsConfig: options.pluginsConfig } : {}),
          ...(options.persistedSession
            ? { resume: { messages: options.persistedSession.messages } }
            : {})
        });
        const sessionId = options.persistedSession?.threadId ?? `poe-agent-${randomUUID()}`;
        sessions.set(sessionId, session as AgentSessionRuntime);

        const response: NewSessionResponse = { sessionId };
        return response as TResult;
      }

      if (method === "session/prompt") {
        const request = params as { sessionId: string; prompt: ContentBlock[] };
        const session = sessions.get(request.sessionId);
        if (!session) {
          throw new Error(`Unknown session "${request.sessionId}".`);
        }

        const promptText = toPromptText(request.prompt);
        await session.sendMessage(promptText, {
          onSessionUpdate: (legacyUpdate) => {
            const normalizedUpdate = normalizeSessionUpdate(legacyUpdate);

            const handlers = notificationHandlers.get("session/update");
            if (!handlers || handlers.length === 0) {
              return;
            }

            const notification: SessionNotification = {
              sessionId: request.sessionId,
              update: normalizedUpdate
            };

            for (const handler of handlers) {
              void handler(notification, { method: "session/update" });
            }
          }
        });

        const timestamp = new Date().toISOString();
        await options.saveSession({
          version: 1,
          threadId: request.sessionId,
          model: options.model,
          cwd: options.cwd,
          createdAt: options.persistedSession?.createdAt ?? timestamp,
          updatedAt: timestamp,
          messages: session.getHistory()
        });

        const response: PromptResponse = { stopReason: "completed" };
        return response as TResult;
      }

      const handlers = requestHandlers.get(method);
      if (handlers && handlers.length > 0) {
        const result = handlers[0](params, { id: null, method });
        return await Promise.resolve(result as TResult);
      }

      throw new Error(`Unsupported ACP request method "${method}".`);
    },
    sendNotification(method: string, params?: unknown): void {
      if (method === "session/cancel") {
        const sessionId = (params as { sessionId?: string } | undefined)?.sessionId;
        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId);
          sessions.delete(sessionId);
          void session?.dispose();
        }
      }
    },
    onRequest(
      method: string,
      handler: (params: unknown, context: { id: string | number | null; method: string }) => unknown
    ): void {
      const current = requestHandlers.get(method) ?? [];
      requestHandlers.set(method, [...current, handler]);
    },
    onNotification(
      method: string,
      handler: (params: unknown, context: { method: string }) => void | Promise<void>
    ): void {
      const current = notificationHandlers.get(method) ?? [];
      notificationHandlers.set(method, [...current, handler]);
    },
    dispose(reason?: Error): void {
      closeTransport(reason ?? new Error("ACP in-memory transport disposed"));
    }
  };
}

async function runPoeAgentAcpLifecycle(
  options: PoeAgentLifecycleOptions
): Promise<PoeAgentSpawnResult> {
  const sessionUpdates: SessionUpdateNotification[] = [];
  const toolState = createToolRenderState();
  let sessionId = "";
  let assistantText = "";
  const pluginsConfig = await loadConfiguredPlugins(options);
  const sessionStore = createAgentSessionStore({ homeDir: options.homeDir, fs: options.fs });
  const persistedSession = options.resumeThreadId
    ? await sessionStore.load(options.resumeThreadId)
    : undefined;
  if (options.resumeThreadId && !persistedSession) {
    throw new Error(
      `Unknown poe-agent thread "${options.resumeThreadId}". Sessions are stored in ~/.poe-code/sessions.`
    );
  }
  const model = options.model ?? persistedSession?.model;
  if (!model) {
    throw new Error("poe-agent requires an explicit model.");
  }

  const transport = createInMemoryAcpTransport({
    model,
    cwd: options.cwd,
    baseUrl: options.baseUrl,
    mcpServers: options.mcpServers,
    pluginsConfig,
    persistedSession,
    saveSession: (session) => sessionStore.save(session)
  });

  const client = new AcpClient({ transport });
  let turn: ReturnType<AcpClient["prompt"]> | undefined;

  try {
    await client.initialize();
    const session = await client.newSession(options.cwd, []);
    sessionId = session.sessionId;

    emitEvent(options.onEvent, {
      event: "session_start",
      threadId: sessionId
    });

    turn = client.prompt(sessionId, [{ type: "text", text: options.prompt }]);
    for await (const notification of turn) {
      sessionUpdates.push(notification);

      const update = notification.params.update;
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        assistantText += update.content.text;
      }

      for (const event of toEventsFromSessionUpdate(notification, toolState)) {
        emitEvent(options.onEvent, event);
      }
    }

    const promptResponse = await turn.response;
    await generateRunReportFromSessionUpdateStream(sessionUpdates, {
      runId: sessionId,
      exitStatus: promptResponse.stopReason === "completed" ? "success" : "failed"
    });

    return {
      stdout: assistantText.length > 0 ? `${assistantText}\n` : "",
      stderr: "",
      exitCode: promptResponse.stopReason === "completed" ? 0 : 1,
      threadId: sessionId
    };
  } catch (error) {
    emitEvent(options.onEvent, {
      event: "error",
      message: toErrorMessage(error),
      ...(toErrorStack(error) ? { stack: toErrorStack(error) } : {})
    });
    throw error;
  } finally {
    await turn?.response.catch(() => undefined);
    await client.dispose();
  }
}

export function spawnPoeAgentWithAcp(options: {
  prompt: string;
  model?: string;
  cwd?: string;
  mcpServers?: McpSpawnConfig;
  baseUrl?: string;
  homeDir?: string;
  configPath?: string;
  projectConfigPath?: string;
  fs?: Pick<ConfigFileSystem, "mkdir" | "readFile" | "writeFile">;
  resumeThreadId?: string;
}): { events: AsyncIterable<AcpEvent>; done: Promise<PoeAgentSpawnResult> } {
  const queue = createEventQueue<AcpEvent>();
  const cwd = options.cwd ?? process.cwd();

  const done = runPoeAgentAcpLifecycle({
    prompt: options.prompt,
    model: options.model,
    cwd,
    baseUrl: options.baseUrl,
    mcpServers: options.mcpServers,
    homeDir: options.homeDir,
    configPath: options.configPath,
    projectConfigPath: options.projectConfigPath,
    fs: options.fs,
    resumeThreadId: options.resumeThreadId,
    onEvent: (event) => {
      queue.push(event);
    }
  }).finally(() => {
    queue.complete();
  });

  return {
    events: queue,
    done
  };
}

export const poeAgentService = createProvider<EmptyProviderOptions>({
  id: "poe-agent",
  name: "poe-agent",
  label: "Poe Agent",
  summary: "Run one-shot prompts with the built-in Poe agent runtime.",
  supportsStdinPrompt: true,
  disabled: true,
  manifest: {
    configure: []
  }
});

export const provider = poeAgentService;
