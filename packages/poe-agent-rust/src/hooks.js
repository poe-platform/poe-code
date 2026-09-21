import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./poe-agent-rust.node");
const events = native.hookEvents(),
  disposers = new WeakMap(),
  warned = new native.NativeHookWarnings();
const emptyAwareness = { readFiles: new Set(), modifiedFiles: new Set() };
function attach(context, dispose) {
  if (dispose) disposers.set(context, dispose);
  return context;
}
async function abort(event, context) {
  let cause;
  const dispose = disposers.get(context);
  if (dispose) {
    try {
      await dispose();
    } catch (error) {
      cause = error;
    }
  }
  throw new AbortError(`Run aborted by ${event} hook decision.`, cause);
}
export class AbortError extends Error {
  constructor(message = "Run aborted.", cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AbortError";
    Error.captureStackTrace?.(this, this.constructor);
  }
}
export class HookRegistry {
  #catalog = new native.NativeHookCatalog();
  #callbacks = [];
  add(plugin) {
    if (!plugin.hooks) return;
    for (const event of events) {
      if (plugin.hooks[event]) {
        const callback = plugin.hooks[event];
        this.#catalog.add(event, this.#callbacks.length);
        this.#callbacks.push(callback);
      }
    }
  }
  async run(event, context) {
    if (typeof event !== "string") return;
    const pipeline = new native.NativeHookPipeline();
    let first,
      index = 0;
    for (;;) {
      const handle = this.#catalog.get(event, index++);
      if (handle === null) break;
      const hook = this.#callbacks[handle],
        decision = await hook(context);
      if (pipeline.observe(decision !== undefined)) first = decision;
    }
    return first;
  }
  copyFrom(registry) {
    const entries = registry.#catalog.snapshot(),
      callbacks = [...registry.#callbacks],
      offset = this.#callbacks.length;
    this.#catalog.append(entries, offset);
    this.#callbacks.push(...callbacks);
  }
}
function evaluate(event, decision) {
  const plan = new native.NativeHookDecision(typeof event === "string" ? event : "", decision);
  for (;;) {
    const request = plan.request();
    let accepted;
    switch (request) {
      case "reject-string":
        accepted = typeof decision.reject === "string";
        break;
      case "block-true":
        accepted = decision.block === true;
        break;
      case "reason-string":
        accepted = typeof decision.reason === "string";
        break;
      case "rewrite-object":
        accepted = typeof decision.rewrite === "object";
        break;
      case "rewrite-nonnull":
        accepted = decision.rewrite !== null;
        break;
      case "rewrite-args":
        accepted = "args" in decision.rewrite;
        break;
      case "replace-object":
        accepted = typeof decision.replace === "object";
        break;
      case "replace-nonnull":
        accepted = decision.replace !== null;
        break;
      case "action-transform":
      case "action-result":
        accepted = decision.action === "transform";
        break;
      case "action-handled":
        accepted = decision.action === "handled";
        break;
      default:
        return request;
    }
    plan.observe(accepted);
  }
}
export async function applyToolCallDecision(decision, context) {
  switch (evaluate("preToolUse", decision)) {
    case "abort":
      await abort("preToolUse", context);
      break;
    case "skip":
      return { type: "skip" };
    case "legacy":
      if (warned.mark("preToolUse")) {
        console.warn(
          "poe-agent hook decision { reject: string } is deprecated. Use { block: true, reason } for preToolUse hooks."
        );
      }
      return { type: "tool_error", error: decision.reject };
    case "block":
      return { type: "tool_error", error: decision.reason };
    case "rewrite":
      return { type: "rewrite", args: decision.rewrite.args };
  }
  return { type: "continue" };
}
export async function applyToolResultDecision(decision, context) {
  const action = evaluate("postToolUse", decision);
  if (action === "abort") await abort("postToolUse", context);
  if (action === "replace") return { type: "replace", patch: decision.replace };
  return { type: "continue" };
}
export async function applyInputDecision(decision, context) {
  const action = evaluate("userPromptSubmit", decision);
  if (action === "abort") await abort("userPromptSubmit", context);
  if (action === "transform") context.prompt = decision.prompt;
  if (action === "handled") return { type: "handled", response: decision.response };
  return { type: "continue" };
}
export async function applyHookDecision(event, decision, context) {
  if (event === "preToolUse") return applyToolCallDecision(decision, context);
  if (event === "postToolUse") return applyToolResultDecision(decision, context);
  if (event === "userPromptSubmit") return applyInputDecision(decision, context);
  const action = evaluate(event, decision);
  if (action === "abort") await abort(event, context);
  return { type: action === "skip" ? "skip" : "continue" };
}
export async function dispatchHook(options) {
  const context = attach(options.ctx, options.disposeRun),
    decision = await options.registry.run(options.event, context);
  return applyHookDecision(options.event, decision, context);
}

export function createSessionStartHookContext(options) {
  return attach(
    {
      session: options.session,
      messages: options.messages,
      signal: options.signal
    },
    options.disposeRun
  );
}
export function createUserPromptSubmitHookContext(options) {
  return attach(
    {
      prompt: options.prompt,
      messages: options.messages,
      signal: options.signal
    },
    options.disposeRun
  );
}
export function createPreToolUseHookContext(options) {
  return attach(
    {
      tool: options.tool,
      args: options.args,
      intentId: options.intentId,
      session: options.session,
      messages: options.messages,
      signal: options.signal
    },
    options.disposeRun
  );
}
export function createPostToolUseHookContext(options) {
  return attach(
    {
      tool: options.tool,
      args: options.args,
      intentId: options.intentId,
      result: options.result,
      error: options.error,
      session: options.session,
      messages: options.messages,
      signal: options.signal
    },
    options.disposeRun
  );
}
export function createPreIterationHookContext(options) {
  const awareness = options.fileAwareness ?? emptyAwareness;
  return attach(
    {
      iterationNumber: options.iterationNumber,
      tokenCount: options.tokenCount,
      messages: options.messages,
      readFiles: awareness.readFiles,
      modifiedFiles: awareness.modifiedFiles,
      signal: options.signal,
      fork: options.fork,
      complete: options.complete,
      runHook: options.runHook
    },
    options.disposeRun
  );
}
export function createPostIterationHookContext(options) {
  const awareness = options.fileAwareness ?? emptyAwareness;
  return attach(
    {
      iterationNumber: options.iterationNumber,
      tokenCount: options.tokenCount,
      messages: options.messages,
      readFiles: awareness.readFiles,
      modifiedFiles: awareness.modifiedFiles,
      signal: options.signal,
      fork: options.fork,
      complete: options.complete,
      runHook: options.runHook
    },
    options.disposeRun
  );
}
export function createPreCompactionHookContext(options) {
  const awareness = options.fileAwareness ?? emptyAwareness;
  return attach(
    {
      tokenCount: options.tokenCount,
      force: options.force,
      messages: options.messages,
      readFiles: awareness.readFiles,
      modifiedFiles: awareness.modifiedFiles,
      signal: options.signal
    },
    options.disposeRun
  );
}
export function createPostCompactionHookContext(options) {
  const awareness = options.fileAwareness ?? emptyAwareness;
  return attach(
    {
      tokenCount: options.tokenCount,
      summary: options.summary,
      droppedMessages: options.droppedMessages,
      messages: options.messages,
      readFiles: awareness.readFiles,
      modifiedFiles: awareness.modifiedFiles,
      signal: options.signal
    },
    options.disposeRun
  );
}
export function createNotificationHookContext(options) {
  return attach(
    {
      event: options.event,
      message: options.message,
      data: options.data,
      messages: options.messages,
      signal: options.signal
    },
    options.disposeRun
  );
}
export function createStopHookContext(options) {
  return attach(
    {
      status: options.status,
      output: options.output,
      error: options.error,
      toolCalls: options.toolCalls,
      messages: options.messages,
      signal: options.signal
    },
    options.disposeRun
  );
}
