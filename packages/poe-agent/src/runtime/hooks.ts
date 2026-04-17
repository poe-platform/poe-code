import type {
  AgentPlugin,
  HookDecision,
  HookDispatchResult,
  HookEvent,
  HookContext,
  IterationContext,
  NotificationContext,
  PostCompactionContext,
  PreCompactionContext,
  SessionStartContext,
  StopContext,
  ToolUseContext,
  UserPromptSubmitContext
} from "./plugin-types.js";
import type { ChatMessage, ForkResult, ToolCallRecord } from "./types.js";

type PluginHooks = NonNullable<AgentPlugin["hooks"]>;
type SessionStartHook = NonNullable<PluginHooks["sessionStart"]>;
type UserPromptSubmitHook = NonNullable<PluginHooks["userPromptSubmit"]>;
type PreToolUseHook = NonNullable<PluginHooks["preToolUse"]>;
type PostToolUseHook = NonNullable<PluginHooks["postToolUse"]>;
type PreIterationHook = NonNullable<PluginHooks["preIteration"]>;
type PostIterationHook = NonNullable<PluginHooks["postIteration"]>;
type PreCompactionHook = NonNullable<PluginHooks["preCompaction"]>;
type PostCompactionHook = NonNullable<PluginHooks["postCompaction"]>;
type NotificationHook = NonNullable<PluginHooks["notification"]>;
type StopHook = NonNullable<PluginHooks["stop"]>;
type DisposeRun = () => void | Promise<void>;

const hookContextDisposers = new WeakMap<object, DisposeRun>();
const SKIPPABLE_HOOK_EVENTS = new Set<HookEvent>([
  "preToolUse",
  "preIteration",
  "preCompaction",
  "notification"
]);

function attachDisposeRun<TContext extends HookContext>(
  context: TContext,
  disposeRun?: DisposeRun
): TContext {
  if (disposeRun) {
    hookContextDisposers.set(context as object, disposeRun);
  }

  return context;
}

async function runHookPipeline<TContext>(
  hooks: Array<(ctx: TContext) => HookDecision | Promise<HookDecision>>,
  context: TContext
): Promise<HookDecision> {
  let firstDecision: HookDecision = undefined;

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
  readonly #sessionStart: SessionStartHook[] = [];
  readonly #userPromptSubmit: UserPromptSubmitHook[] = [];
  readonly #preToolUse: PreToolUseHook[] = [];
  readonly #postToolUse: PostToolUseHook[] = [];
  readonly #preIteration: PreIterationHook[] = [];
  readonly #postIteration: PostIterationHook[] = [];
  readonly #preCompaction: PreCompactionHook[] = [];
  readonly #postCompaction: PostCompactionHook[] = [];
  readonly #notification: NotificationHook[] = [];
  readonly #stop: StopHook[] = [];

  add(plugin: AgentPlugin): void {
    if (!plugin.hooks) {
      return;
    }

    if (plugin.hooks.sessionStart) {
      this.#sessionStart.push(plugin.hooks.sessionStart);
    }

    if (plugin.hooks.userPromptSubmit) {
      this.#userPromptSubmit.push(plugin.hooks.userPromptSubmit);
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

    if (plugin.hooks.preCompaction) {
      this.#preCompaction.push(plugin.hooks.preCompaction);
    }

    if (plugin.hooks.postCompaction) {
      this.#postCompaction.push(plugin.hooks.postCompaction);
    }

    if (plugin.hooks.notification) {
      this.#notification.push(plugin.hooks.notification);
    }

    if (plugin.hooks.stop) {
      this.#stop.push(plugin.hooks.stop);
    }
  }

  async run(event: HookEvent, ctx: HookContext): Promise<HookDecision> {
    switch (event) {
      case "sessionStart":
        return runHookPipeline(this.#sessionStart, ctx as SessionStartContext);
      case "userPromptSubmit":
        return runHookPipeline(this.#userPromptSubmit, ctx as UserPromptSubmitContext);
      case "preToolUse":
        return runHookPipeline(this.#preToolUse, ctx as ToolUseContext);
      case "postToolUse":
        return runHookPipeline(this.#postToolUse, ctx as ToolUseContext);
      case "preIteration":
        return runHookPipeline(this.#preIteration, ctx as IterationContext);
      case "postIteration":
        return runHookPipeline(this.#postIteration, ctx as IterationContext);
      case "preCompaction":
        return runHookPipeline(this.#preCompaction, ctx as PreCompactionContext);
      case "postCompaction":
        return runHookPipeline(this.#postCompaction, ctx as PostCompactionContext);
      case "notification":
        return runHookPipeline(this.#notification, ctx as NotificationContext);
      case "stop":
        return runHookPipeline(this.#stop, ctx as StopContext);
      default:
        return undefined;
    }
  }

  copyFrom(registry: HookRegistry): void {
    this.#sessionStart.push(...registry.#sessionStart);
    this.#userPromptSubmit.push(...registry.#userPromptSubmit);
    this.#preToolUse.push(...registry.#preToolUse);
    this.#postToolUse.push(...registry.#postToolUse);
    this.#preIteration.push(...registry.#preIteration);
    this.#postIteration.push(...registry.#postIteration);
    this.#preCompaction.push(...registry.#preCompaction);
    this.#postCompaction.push(...registry.#postCompaction);
    this.#notification.push(...registry.#notification);
    this.#stop.push(...registry.#stop);
  }
}

export type CreateSessionStartHookContextOptions = {
  session: Map<string, unknown>;
  messages: ChatMessage[];
  signal: AbortSignal;
  disposeRun?: DisposeRun;
};

export type CreateUserPromptSubmitHookContextOptions = {
  prompt: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  disposeRun?: DisposeRun;
};

export type CreatePreToolUseHookContextOptions = {
  tool: string;
  args: unknown;
  intentId: string;
  session: Map<string, unknown>;
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
  session: Map<string, unknown>;
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
  complete: IterationContext["complete"];
  runHook: IterationContext["runHook"];
  disposeRun?: DisposeRun;
};

export type CreatePostIterationHookContextOptions = {
  iterationNumber: number;
  tokenCount: number;
  messages: ChatMessage[];
  signal: AbortSignal;
  fork(prompt: string): Promise<ForkResult>;
  complete: IterationContext["complete"];
  runHook: IterationContext["runHook"];
  disposeRun?: DisposeRun;
};

export type CreatePreCompactionHookContextOptions = {
  tokenCount: number;
  force: boolean;
  messages: ChatMessage[];
  signal: AbortSignal;
  disposeRun?: DisposeRun;
};

export type CreatePostCompactionHookContextOptions = {
  tokenCount: number;
  summary: string;
  droppedMessages: ChatMessage[];
  messages: ChatMessage[];
  signal: AbortSignal;
  disposeRun?: DisposeRun;
};

export type CreateNotificationHookContextOptions = {
  event: string;
  message?: string;
  data?: unknown;
  messages: ChatMessage[];
  signal: AbortSignal;
  disposeRun?: DisposeRun;
};

export type CreateStopHookContextOptions = {
  status: "completed" | "error";
  output?: string;
  error?: Error;
  toolCalls: ToolCallRecord[];
  messages: ChatMessage[];
  signal: AbortSignal;
  disposeRun?: DisposeRun;
};

export function createSessionStartHookContext(
  options: CreateSessionStartHookContextOptions
): SessionStartContext {
  return attachDisposeRun(
    {
      session: options.session,
      messages: options.messages,
      signal: options.signal
    },
    options.disposeRun
  );
}

export function createUserPromptSubmitHookContext(
  options: CreateUserPromptSubmitHookContextOptions
): UserPromptSubmitContext {
  return attachDisposeRun(
    {
      prompt: options.prompt,
      messages: options.messages,
      signal: options.signal
    },
    options.disposeRun
  );
}

export function createPreToolUseHookContext(
  options: CreatePreToolUseHookContextOptions
): ToolUseContext {
  return attachDisposeRun(
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

export function createPostToolUseHookContext(
  options: CreatePostToolUseHookContextOptions
): ToolUseContext {
  return attachDisposeRun(
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

export function createPreIterationHookContext(
  options: CreatePreIterationHookContextOptions
): IterationContext {
  return attachDisposeRun(
    {
      iterationNumber: options.iterationNumber,
      tokenCount: options.tokenCount,
      messages: options.messages,
      signal: options.signal,
      fork: options.fork,
      complete: options.complete,
      runHook: options.runHook
    },
    options.disposeRun
  );
}

export function createPostIterationHookContext(
  options: CreatePostIterationHookContextOptions
): IterationContext {
  return attachDisposeRun(
    {
      iterationNumber: options.iterationNumber,
      tokenCount: options.tokenCount,
      messages: options.messages,
      signal: options.signal,
      fork: options.fork,
      complete: options.complete,
      runHook: options.runHook
    },
    options.disposeRun
  );
}

export function createPreCompactionHookContext(
  options: CreatePreCompactionHookContextOptions
): PreCompactionContext {
  return attachDisposeRun(
    {
      tokenCount: options.tokenCount,
      force: options.force,
      messages: options.messages,
      signal: options.signal
    },
    options.disposeRun
  );
}

export function createPostCompactionHookContext(
  options: CreatePostCompactionHookContextOptions
): PostCompactionContext {
  return attachDisposeRun(
    {
      tokenCount: options.tokenCount,
      summary: options.summary,
      droppedMessages: options.droppedMessages,
      messages: options.messages,
      signal: options.signal
    },
    options.disposeRun
  );
}

export function createNotificationHookContext(
  options: CreateNotificationHookContextOptions
): NotificationContext {
  return attachDisposeRun(
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

export function createStopHookContext(options: CreateStopHookContextOptions): StopContext {
  return attachDisposeRun(
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

export async function applyHookDecision(
  event: HookEvent,
  decision: HookDecision,
  ctx: HookContext
): Promise<HookDispatchResult> {
  if (decision === undefined) {
    return { type: "continue" };
  }

  if (decision === "skip") {
    if (SKIPPABLE_HOOK_EVENTS.has(event)) {
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
        error: decision.reject
      };
    }

    await abortHookExecution(event, ctx);
  }

  return { type: "continue" };
}

export async function dispatchHook(options: {
  registry: HookRegistry;
  event: HookEvent;
  ctx: HookContext;
  disposeRun?: DisposeRun;
}): Promise<HookDispatchResult> {
  const context = attachDisposeRun(options.ctx, options.disposeRun);
  const decision = await options.registry.run(options.event, context);
  return applyHookDecision(options.event, decision, context);
}
