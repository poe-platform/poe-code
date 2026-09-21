import { AcpClient } from "./acp/index.js";
import { createAgentSession } from "./agent-session.js";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./poe-agent-rust.node");
const coerceChunk = (value) => "" + value;
var _a;
import { runAcpCore } from "./acp-core.js";
import { applyHookDecision, createNotificationHookContext } from "./hooks.js";
import { createRunContext } from "./run-context.js";
export class AgentHost {
  #runContext;
  #model;
  #baseSystemPrompt;
  #maxIterations;
  #emit;
  #runtimeEmit;
  #createSpawnSession;
  #state = new native.NativeAgentHostState();
  constructor(options) {
    this.#runContext = options.runContext;
    this.#model = options.model;
    this.#baseSystemPrompt = options.baseSystemPrompt;
    this.#maxIterations = options.maxIterations;
    this.#emit = options.emit;
    this.#createSpawnSession = options.createSpawnSession;
  }
  setEmit(emit) {
    this.#runtimeEmit = emit;
  }
  async handle(intent) {
    const tool = this.#runContext.tools.get(intent.tool);
    if (!tool) {
      return {
        status: "error",
        result: `Unknown tool: ${intent.tool}`
      };
    }
    const toolContext = {
      fork: async (prompt) => {
        const forkSequence = this.#state.nextFork();
        return this.fork({
          forkId: `fork-${forkSequence}`,
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
  async fork(request) {
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
  async spawn(prompt) {
    const spawnSession = await this.#createSpawnSession();
    const mcpServers = spawnSession.mcpServers ?? [];
    const collected = new native.NativeAgentSpawnOutput();
    try {
      await spawnSession.client.initialize();
      const session = await spawnSession.client.newSession(spawnSession.cwd, mcpServers);
      const turn = spawnSession.client.prompt(session.sessionId, [{ type: "text", text: prompt }]);
      for await (const notification of turn) {
        collected.consume(notification, coerceChunk);
      }
      const response = await turn.response;
      if (response.stopReason !== "completed") {
        throw new Error(`Spawned session ended with stop reason: ${response.stopReason}`);
      }
      const output = collected.finish();
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
  async #consumeToolInvocation(invocation) {
    const signal = this.#runContext.abortController.signal;
    const invocationState = new native.NativeAgentInvocation();
    const closeInvocation = async () => {
      if (!invocationState.beginClose()) {
        return;
      }

      try {
        await invocation.return(undefined);
      } catch {
        return;
      }
    };
    const onAbort = () => {
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
        const delta = native.isAgentToolDelta(next);
        (this.#runtimeEmit ?? this.#emit)?.(native.mapAgentToolYield(next, delta));
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
  async #notify(notification) {
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
  async #runFork(request) {
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
    const childHost = new _a({
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
_a = AgentHost;
function linkAbortController(parent, child) {
  const onAbort = () => {
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
function toErrorMessage(value) {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  return String(value);
}

export function createProcessSpawnSession(options) {
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
export function createInMemorySpawnSession(options) {
  const transport = createInMemoryAcpTransport(options);
  const client = new AcpClient({ transport });
  return {
    client,
    cwd: options.cwd,
    mcpServers: []
  };
}
export function createInMemoryAcpTransport(options) {
  const createSession = options.createSession ?? createAgentSession;
  const sessions = new Map();
  const notificationHandlers = new Map();
  const requestHandlers = new Map();
  const lifecycle = new native.NativeAgentMemoryTransport();
  const pendingCreates = new Set();
  let resolveClosed;
  const closedPromise = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  const closeTransport = (reason) => {
    if (!lifecycle.beginClose()) return;
    const activeSessions = Array.from(sessions.values());
    sessions.clear();
    void Promise.allSettled([
      ...activeSessions.map(async (session) => session.dispose()),
      ...pendingCreates
    ]).then((results) => {
      const failure = results.find((result) => result.status === "rejected");
      resolveClosed?.({
        code: 0,
        signal: null,
        reason: failure?.reason ?? reason,
        stderr: ""
      });
    });
  };
  return {
    closed: closedPromise,
    async sendRequest(method, params) {
      if (lifecycle.closed) throw new Error("In-memory ACP transport is disposed.");
      if (method === "initialize") {
        const request = params;
        const response = {
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
        return response;
      }
      if (method === "session/new") {
        const request = params;
        const creation = Promise.resolve(
          createSession({
            model: options.model,
            cwd: request?.cwd ?? options.cwd,
            ...(options.mode === undefined ? {} : { mode: options.mode }),
            ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
            ...(options.mcpServers === undefined ? {} : { mcpServers: options.mcpServers })
          })
        ).then(async (session) => {
          if (lifecycle.closed) await session.dispose();
          return session;
        });
        pendingCreates.add(creation);
        let session;
        try {
          session = await creation;
        } finally {
          pendingCreates.delete(creation);
        }
        const sessionId = `poe-agent-spawn-${lifecycle.nextSession()}`;
        sessions.set(sessionId, session);
        const response = { sessionId };
        return response;
      }
      if (method === "session/prompt") {
        const request = params;
        const session = sessions.get(request.sessionId);
        if (!session) {
          throw new Error(`Unknown session "${request.sessionId}".`);
        }
        const reply = await session.sendMessage(toPromptText(request.prompt));
        if (lifecycle.closed) throw new Error("In-memory ACP transport is disposed.");
        const replyText =
          typeof reply.content === "string"
            ? reply.content
            : reply.content.map((part) => (part.type === "text" ? part.text : "")).join("");
        if (replyText.length > 0) {
          const handlers = notificationHandlers.get("session/update") ?? [];
          if (handlers.length > 0) {
            const notification = {
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
              await handler(notification, { method: "session/update" });
            }
          }
        }
        const response = { stopReason: "completed" };
        return response;
      }
      const handlers = requestHandlers.get(method);
      if (handlers && handlers.length > 0) {
        const result = handlers[0]?.(params, { id: null, method });
        return await Promise.resolve(result);
      }
      throw new Error(`Unsupported ACP request method "${method}".`);
    },
    sendNotification(method, params) {
      if (method !== "session/cancel") {
        return;
      }
      const sessionId = params?.sessionId;
      if (!sessionId) {
        return;
      }
      const session = sessions.get(sessionId);
      if (!session) {
        return;
      }
      sessions.delete(sessionId);
      void Promise.resolve()
        .then(() => session.dispose())
        .catch((error) => closeTransport(error));
    },
    onRequest(method, handler) {
      const current = requestHandlers.get(method) ?? [];
      requestHandlers.set(method, [...current, handler]);
    },
    onNotification(method, handler) {
      const current = notificationHandlers.get(method) ?? [];
      notificationHandlers.set(method, [...current, handler]);
    },
    dispose(reason) {
      closeTransport(reason ?? new Error("In-memory ACP transport disposed."));
    }
  };
}
function toPromptText(prompt) {
  const lines = [];
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
