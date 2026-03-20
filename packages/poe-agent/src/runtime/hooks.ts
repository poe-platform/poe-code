import type { AgentPlugin, HookDecision, IterationContext, ToolUseContext } from "./plugin-types.js";
import type { ChatMessage, ForkResult } from "./types.js";

export type HookEvent = "preToolUse" | "postToolUse" | "preIteration" | "postIteration";

export type HookContext = ToolUseContext | IterationContext;

type PluginHooks = NonNullable<AgentPlugin["hooks"]>;
type PreToolUseHook = NonNullable<PluginHooks["preToolUse"]>;
type PostToolUseHook = NonNullable<PluginHooks["postToolUse"]>;
type PreIterationHook = NonNullable<PluginHooks["preIteration"]>;
type PostIterationHook = NonNullable<PluginHooks["postIteration"]>;
type DisposeRun = () => void | Promise<void>;

const hookContextDisposers = new WeakMap<object, DisposeRun>();
const PRE_HOOK_EVENTS = new Set<HookEvent>(["preToolUse", "preIteration"]);

function attachDisposeRun<TContext extends HookContext>(
  context: TContext,
  disposeRun?: DisposeRun,
): TContext {
  if (disposeRun) {
    hookContextDisposers.set(context as object, disposeRun);
  }

  return context;
}

async function runHookPipeline<TContext>(
  hooks: Array<(ctx: TContext) => HookDecision | Promise<HookDecision>>,
  context: TContext,
): Promise<HookDecision> {
  let firstDecision: HookDecision;

  for (const hook of hooks) {
    const decision = await hook(context);
    if (firstDecision === undefined && decision !== undefined) {
      firstDecision = decision;
    }
  }

  return firstDecision;
}

async function abortHookExecution(event: HookEvent, context: HookContext): Promise<never> {
  const disposeRun = hookContextDisposers.get(context as object);
  let disposeError: unknown;
  if (disposeRun) {
    try {
      await disposeRun();
    } catch (error) {
      disposeError = error;
    }
  }

  throw new AbortError(`Run aborted by ${event} hook decision.`, disposeError);
}

function isRejectDecision(decision: HookDecision): decision is { reject: string } {
  if (typeof decision !== "object" || decision === null) {
    return false;
  }

  const candidate = decision as Partial<{ reject: unknown }>;
  return typeof candidate.reject === "string";
}

export class AbortError extends Error {
  constructor(message = "Run aborted.", cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AbortError";

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class HookRegistry {
  readonly #preToolUse: PreToolUseHook[] = [];
  readonly #postToolUse: PostToolUseHook[] = [];
  readonly #preIteration: PreIterationHook[] = [];
  readonly #postIteration: PostIterationHook[] = [];

  add(plugin: AgentPlugin): void {
    if (!plugin.hooks) {
      return;
    }

    if (plugin.hooks.preToolUse) {
      this.#preToolUse.push(plugin.hooks.preToolUse);
    }

    if (plugin.hooks.postToolUse) {
      this.#postToolUse.push(plugin.hooks.postToolUse);
    }

    if (plugin.hooks.preIteration) {
      this.#preIteration.push(plugin.hooks.preIteration);
    }

    if (plugin.hooks.postIteration) {
      this.#postIteration.push(plugin.hooks.postIteration);
    }
  }

  async run(event: HookEvent, ctx: HookContext): Promise<HookDecision> {
    switch (event) {
      case "preToolUse":
        return runHookPipeline(this.#preToolUse, ctx as ToolUseContext);
      case "postToolUse":
        return runHookPipeline(this.#postToolUse, ctx as ToolUseContext);
      case "preIteration":
        return runHookPipeline(this.#preIteration, ctx as IterationContext);
      case "postIteration":
        return runHookPipeline(this.#postIteration, ctx as IterationContext);
      default:
        return undefined;
    }
  }
}

export type CreatePreToolUseHookContextOptions = {
  tool: string;
  args: unknown;
  intentId: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  disposeRun?: DisposeRun;
};

export type CreatePostToolUseHookContextOptions = {
  tool: string;
  args: unknown;
  intentId: string;
  result?: unknown;
  error?: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  disposeRun?: DisposeRun;
};

export type CreatePreIterationHookContextOptions = {
  iterationNumber: number;
  tokenCount: number;
  messages: ChatMessage[];
  signal: AbortSignal;
  fork(prompt: string): Promise<ForkResult>;
  disposeRun?: DisposeRun;
};

export type CreatePostIterationHookContextOptions = {
  iterationNumber: number;
  tokenCount: number;
  messages: ChatMessage[];
  signal: AbortSignal;
  fork(prompt: string): Promise<ForkResult>;
  disposeRun?: DisposeRun;
};

export function createPreToolUseHookContext(
  options: CreatePreToolUseHookContextOptions,
): ToolUseContext {
  return attachDisposeRun(
    {
      tool: options.tool,
      args: options.args,
      intentId: options.intentId,
      messages: options.messages,
      signal: options.signal,
    },
    options.disposeRun,
  );
}

export function createPostToolUseHookContext(
  options: CreatePostToolUseHookContextOptions,
): ToolUseContext {
  return attachDisposeRun(
    {
      tool: options.tool,
      args: options.args,
      intentId: options.intentId,
      result: options.result,
      error: options.error,
      messages: options.messages,
      signal: options.signal,
    },
    options.disposeRun,
  );
}

export function createPreIterationHookContext(
  options: CreatePreIterationHookContextOptions,
): IterationContext {
  return attachDisposeRun(
    {
      iterationNumber: options.iterationNumber,
      tokenCount: options.tokenCount,
      messages: options.messages,
      signal: options.signal,
      fork: options.fork,
    },
    options.disposeRun,
  );
}

export function createPostIterationHookContext(
  options: CreatePostIterationHookContextOptions,
): IterationContext {
  return attachDisposeRun(
    {
      iterationNumber: options.iterationNumber,
      tokenCount: options.tokenCount,
      messages: options.messages,
      signal: options.signal,
      fork: options.fork,
    },
    options.disposeRun,
  );
}

export type HookDispatchResult =
  | { type: "continue" }
  | { type: "skip" }
  | { type: "tool_error"; error: string };

export async function applyHookDecision(
  event: HookEvent,
  decision: HookDecision,
  ctx: HookContext,
): Promise<HookDispatchResult> {
  if (decision === undefined) {
    return { type: "continue" };
  }

  if (decision === "skip") {
    if (PRE_HOOK_EVENTS.has(event)) {
      return { type: "skip" };
    }

    return { type: "continue" };
  }

  if (decision === "abort") {
    await abortHookExecution(event, ctx);
  }

  if (isRejectDecision(decision)) {
    if (event === "preToolUse") {
      return {
        type: "tool_error",
        error: decision.reject,
      };
    }

    await abortHookExecution(event, ctx);
  }

  return { type: "continue" };
}
