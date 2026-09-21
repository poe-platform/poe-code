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
