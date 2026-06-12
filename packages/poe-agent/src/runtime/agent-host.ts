import {
  AcpClient,
  type AcpTransportClosedEvent,
  type ContentBlock,
  type InitializeResponse,
  type McpServer,
  type NewSessionResponse,
  type PromptResponse,
  type SessionNotification
} from "@poe-code/poe-acp-client";
import {
  createAgentSession,
  type AgentSession,
  type CreateAgentSessionOptions
} from "../agent-session.js";
import type { SpawnMode } from "@poe-code/agent-spawn";
import { runAcpCore, type AcpModel } from "./acp-core.js";
import { applyHookDecision, createNotificationHookContext } from "./hooks.js";
import { createRunContext, type RunContext } from "./run-context.js";
import type {
  AcpEvent,
  AcpHost,
  ForkRequest,
  ForkResult,
  RunOutput,
  ToolAckResult,
  ToolContext,
  ToolEvent,
  ToolIntent
} from "./types.js";

type InMemorySession = Pick<AgentSession, "sendMessage" | "dispose">;
type InMemoryCreateSession = (options: CreateAgentSessionOptions) => Promise<InMemorySession>;

type InMemoryNotificationHandler = (
  params: unknown,
  context: { method: string }
) => void | Promise<void>;

type InMemoryRequestHandler = (
  params: unknown,
  context: { id: string | number | null; method: string }
) => unknown | Promise<unknown>;

type InMemoryAcpTransport = {
  closed: Promise<AcpTransportClosedEvent>;
  sendRequest<TResult = unknown>(method: string, params?: unknown): Promise<TResult>;
  sendNotification(method: string, params?: unknown): void;
  onRequest(method: string, handler: InMemoryRequestHandler): void;
  onNotification(method: string, handler: InMemoryNotificationHandler): void;
  dispose(reason?: Error): void;
};

export type AgentHostSpawnClient = Pick<
  AcpClient,
  "initialize" | "newSession" | "prompt" | "dispose"
>;

export type AgentHostSpawnSession = {
  client: AgentHostSpawnClient;
  cwd: string;
  mcpServers?: McpServer[];
};

export type AgentHostOptions = {
  runContext: RunContext;
  model: AcpModel;
  baseSystemPrompt?: string;
  maxIterations?: number;
  emit?(event: AcpEvent): void;
  createSpawnSession(): AgentHostSpawnSession | Promise<AgentHostSpawnSession>;
};

export type CreateProcessSpawnSessionOptions = {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type CreateInMemorySpawnSessionOptions = {
  model: string;
  cwd: string;
  mode?: SpawnMode;
  baseUrl?: string;
  mcpServers?: CreateAgentSessionOptions["mcpServers"];
  createSession?: InMemoryCreateSession;
};

export class AgentHost implements AcpHost {
  readonly #runContext: RunContext;
  readonly #model: AcpModel;
  readonly #baseSystemPrompt?: string;
  readonly #maxIterations?: number;
  readonly #emit?: (event: AcpEvent) => void;
  #runtimeEmit?: (event: AcpEvent) => void;
  readonly #createSpawnSession: AgentHostOptions["createSpawnSession"];
  #forkSequence = 0;

  constructor(options: AgentHostOptions) {
    this.#runContext = options.runContext;
    this.#model = options.model;
    this.#baseSystemPrompt = options.baseSystemPrompt;
    this.#maxIterations = options.maxIterations;
    this.#emit = options.emit;
    this.#createSpawnSession = options.createSpawnSession;
  }

  setEmit(emit: (event: AcpEvent) => void): void {
    this.#runtimeEmit = emit;
  }

  async handle(intent: ToolIntent): Promise<ToolAckResult> {
    const tool = this.#runContext.tools.get(intent.tool);
    if (!tool) {
      return {
        status: "error",
        result: `Unknown tool: ${intent.tool}`
      };
    }

    const toolContext: ToolContext = {
      fork: async (prompt) => {
        this.#forkSequence += 1;
        return this.fork({
          forkId: `fork-${this.#forkSequence}`,
          prompt,
          context: {
            messages: [...this.#runContext.messages],
            toolCalls: []
          }
        });
      },
      spawn: async (prompt) => this.spawn(prompt),
      signal: this.#runContext.abortController.signal,
      notify: async (notification) => this.#notify(notification)
    };

    try {
      const result = await this.#consumeToolInvocation(tool.invoke(intent.args, toolContext));
      return {
        status: "success",
        result
      };
    } catch (error) {
      return {
        status: "error",
        result: toErrorMessage(error)
      };
    }
  }

  async fork(request: ForkRequest): Promise<ForkResult> {
    this.#emit?.({
      type: "fork.start",
      forkId: request.forkId,
      prompt: request.prompt
    });

    try {
      const result = await this.#runContext.trackChildRun(this.#runFork(request));
      this.#emit?.({
        type: "fork.complete",
        forkId: request.forkId,
        result
      });
      return result;
    } catch (error) {
      const message = toErrorMessage(error);
      this.#emit?.({
        type: "fork.error",
        forkId: request.forkId,
        error: message
      });
      throw error;
    }
  }

  async spawn(prompt: string): Promise<RunOutput> {
    const spawnSession = await this.#createSpawnSession();
    const mcpServers = spawnSession.mcpServers ?? [];
    let output = "";

    try {
      await spawnSession.client.initialize();
      const session = await spawnSession.client.newSession(spawnSession.cwd, mcpServers);
      const turn = spawnSession.client.prompt(session.sessionId, [{ type: "text", text: prompt }]);

      for await (const notification of turn) {
        const update = notification.params.update;
        if (update.sessionUpdate !== "agent_message_chunk") {
          continue;
        }

        if (update.content.type !== "text") {
          continue;
        }

        output += update.content.text;
      }

      const response = await turn.response;
      if (response.stopReason !== "completed") {
        throw new Error(`Spawned session ended with stop reason: ${response.stopReason}`);
      }

      return {
        output,
        messages: [
          {
            role: "assistant",
            content: output
          }
        ]
      };
    } finally {
      await spawnSession.client.dispose();
    }
  }

  async #consumeToolInvocation(
    invocation: AsyncGenerator<ToolEvent, unknown, void>
  ): Promise<unknown> {
    const signal = this.#runContext.abortController.signal;
    let closed = false;
    const closeInvocation = async (): Promise<void> => {
      if (closed) {
        return;
      }

      closed = true;

      try {
        await invocation.return(undefined);
      } catch {
        return;
      }
    };

    const onAbort = (): void => {
      void closeInvocation();
    };

    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      while (true) {
        const next = await invocation.next();
        if (next.done) {
          return next.value;
        }

        if (next.value.type === "message.delta") {
          (this.#runtimeEmit ?? this.#emit)?.({
            type: "message.delta",
            content: next.value.content
          });
          continue;
        }

        (this.#runtimeEmit ?? this.#emit)?.({
          type: "progress",
          message: next.value.message
        });
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  async #notify(notification: { event: string; message?: string; data?: unknown }): Promise<void> {
    const signal = this.#runContext.abortController.signal;
    if (signal.aborted) {
      return;
    }

    const context = createNotificationHookContext({
      event: notification.event,
      message: notification.message,
      data: notification.data,
      messages: this.#runContext.messages,
      signal
    });

    try {
      const decision = await this.#runContext.hooks.run("notification", context);
      await applyHookDecision("notification", decision, context);
    } catch (error) {
      await this.#runContext.dispose().catch(() => undefined);
      throw error;
    }
  }

  async #runFork(request: ForkRequest): Promise<ForkResult> {
    const childContext = createRunContext({
      activeSkills: this.#runContext.activeSkills
    });
    childContext.messages.push(...request.context.messages);
    childContext.tools.copyFrom(this.#runContext.tools);
    childContext.prompts.copyFrom(this.#runContext.prompts);
    childContext.hooks.copyFrom(this.#runContext.hooks);

    const removeAbortListener = linkAbortController(
      this.#runContext.abortController.signal,
      childContext.abortController
    );
    childContext.registerDisposeHook(removeAbortListener);

    const childHost = new AgentHost({
      runContext: childContext,
      model: this.#model,
      baseSystemPrompt: this.#baseSystemPrompt,
      maxIterations: this.#maxIterations,
      emit: this.#emit,
      createSpawnSession: this.#createSpawnSession
    });

    const childEvents = runAcpCore({
      prompt: request.prompt,
      runContext: childContext,
      host: childHost,
      model: this.#model,
      baseSystemPrompt: this.#baseSystemPrompt,
      maxIterations: this.#maxIterations
    });

    for await (const event of childEvents) {
      if (event.type === "session.complete") {
        return {
          output: event.result.output,
          messages: event.result.messages
        };
      }

      if (event.type === "session.error") {
        throw event.error;
      }
    }

    throw new Error("Fork run ended without a terminal event.");
  }
}

export function createProcessSpawnSession(
  options: CreateProcessSpawnSessionOptions
): AgentHostSpawnSession {
  const cwd = options.cwd ?? process.cwd();
  const client = new AcpClient({
    command: options.command,
    args: options.args,
    cwd,
    ...(options.env === undefined ? {} : { env: options.env })
  });

  return {
    client,
    cwd,
    mcpServers: []
  };
}

export function createInMemorySpawnSession(
  options: CreateInMemorySpawnSessionOptions
): AgentHostSpawnSession {
  const transport = createInMemoryAcpTransport(options);
  const client = new AcpClient({ transport });

  return {
    client,
    cwd: options.cwd,
    mcpServers: []
  };
}

export function createInMemoryAcpTransport(
  options: CreateInMemorySpawnSessionOptions
): InMemoryAcpTransport {
  const createSession = options.createSession ?? createAgentSession;
  const sessions = new Map<string, InMemorySession>();
  const notificationHandlers = new Map<string, InMemoryNotificationHandler[]>();
  const requestHandlers = new Map<string, InMemoryRequestHandler[]>();

  let closed = false;
  let sessionCounter = 0;
  let resolveClosed: ((event: AcpTransportClosedEvent) => void) | undefined;

  const closedPromise = new Promise<AcpTransportClosedEvent>((resolve) => {
    resolveClosed = resolve;
  });

  const closeTransport = (reason: Error): void => {
    if (closed) {
      return;
    }

    closed = true;

    const activeSessions = Array.from(sessions.values());
    sessions.clear();

    void Promise.all(activeSessions.map(async (session) => session.dispose())).finally(() => {
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
        const request = params as { protocolVersion?: number } | undefined;
        const response: InitializeResponse = {
          protocolVersion: request?.protocolVersion ?? 1,
          agentInfo: {
            name: "poe-agent",
            version: "0.0.1"
          },
          agentCapabilities: {
            sessionCapabilities: {},
            promptCapabilities: {}
          }
        };
        return response as TResult;
      }

      if (method === "session/new") {
        const request = params as { cwd?: string } | undefined;
        const session = await createSession({
          model: options.model,
          cwd: request?.cwd ?? options.cwd,
          ...(options.mode === undefined ? {} : { mode: options.mode }),
          ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
          ...(options.mcpServers === undefined ? {} : { mcpServers: options.mcpServers })
        });
        sessionCounter += 1;
        const sessionId = `poe-agent-spawn-${sessionCounter}`;
        sessions.set(sessionId, session);

        const response: NewSessionResponse = { sessionId };
        return response as TResult;
      }

      if (method === "session/prompt") {
        const request = params as { sessionId: string; prompt: ContentBlock[] };
        const session = sessions.get(request.sessionId);
        if (!session) {
          throw new Error(`Unknown session "${request.sessionId}".`);
        }

        const reply = await session.sendMessage(toPromptText(request.prompt));
        const replyText =
          typeof reply.content === "string"
            ? reply.content
            : reply.content
                .map((part) => (part.type === "text" ? part.text : ""))
                .join("");
        if (replyText.length > 0) {
          const handlers = notificationHandlers.get("session/update") ?? [];
          if (handlers.length > 0) {
            const notification: SessionNotification = {
              sessionId: request.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: {
                  type: "text",
                  text: replyText
                }
              }
            };

            for (const handler of handlers) {
              void handler(notification, { method: "session/update" });
            }
          }
        }

        const response: PromptResponse = { stopReason: "completed" };
        return response as TResult;
      }

      const handlers = requestHandlers.get(method);
      if (handlers && handlers.length > 0) {
        const result = handlers[0]?.(params, { id: null, method });
        return await Promise.resolve(result as TResult);
      }

      throw new Error(`Unsupported ACP request method "${method}".`);
    },
    sendNotification(method: string, params?: unknown): void {
      if (method !== "session/cancel") {
        return;
      }

      const sessionId = (params as { sessionId?: string } | undefined)?.sessionId;
      if (!sessionId) {
        return;
      }

      const session = sessions.get(sessionId);
      if (!session) {
        return;
      }

      sessions.delete(sessionId);
      void session.dispose();
    },
    onRequest(method: string, handler: InMemoryRequestHandler): void {
      const current = requestHandlers.get(method) ?? [];
      requestHandlers.set(method, [...current, handler]);
    },
    onNotification(method: string, handler: InMemoryNotificationHandler): void {
      const current = notificationHandlers.get(method) ?? [];
      notificationHandlers.set(method, [...current, handler]);
    },
    dispose(reason?: Error): void {
      closeTransport(reason ?? new Error("In-memory ACP transport disposed."));
    }
  };
}

function linkAbortController(parent: AbortSignal, child: AbortController): () => void {
  const onAbort = (): void => {
    if (!child.signal.aborted) {
      child.abort(parent.reason);
    }
  };

  if (parent.aborted) {
    onAbort();
    return () => undefined;
  }

  parent.addEventListener("abort", onAbort, { once: true });
  return () => {
    parent.removeEventListener("abort", onAbort);
  };
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

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  return String(value);
}
