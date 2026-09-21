import type {
  AgentPlugin,
  FileAwareness,
  HookDecision,
  HookDispatchResult,
  HookEvent,
  HookContext,
  HookContextByEvent,
  InputDecision,
  IterationContext,
  NotificationContext,
  PostCompactionContext,
  PreCompactionContext,
  SessionStartContext,
  StopContext,
  ToolCallDecision,
  ToolResultDecision,
  ToolUseContext,
  UserPromptSubmitContext
} from "./plugin-types.js";
import type { ChatMessage, ForkResult, ToolCallRecord } from "./types.js";
type DisposeRun = () => void | Promise<void>;
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
  fileAwareness?: FileAwareness;
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
  fileAwareness?: FileAwareness;
  disposeRun?: DisposeRun;
};
export type CreatePreCompactionHookContextOptions = {
  tokenCount: number;
  force: boolean;
  messages: ChatMessage[];
  fileAwareness?: FileAwareness;
  signal: AbortSignal;
  disposeRun?: DisposeRun;
};
export type CreatePostCompactionHookContextOptions = {
  tokenCount: number;
  summary: string;
  droppedMessages: ChatMessage[];
  messages: ChatMessage[];
  fileAwareness?: FileAwareness;
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
export declare class AbortError extends Error {
  constructor(message?: string, cause?: unknown);
}
export declare class HookRegistry {
  #private;
  add(plugin: AgentPlugin): void;
  run<TEvent extends HookEvent>(
    event: TEvent,
    ctx: HookContextByEvent[TEvent]
  ): Promise<
    | (TEvent extends "preToolUse"
        ? ToolCallDecision
        : TEvent extends "postToolUse"
          ? ToolResultDecision
          : TEvent extends "userPromptSubmit"
            ? InputDecision
            : HookDecision)
    | undefined
  >;
  copyFrom(registry: HookRegistry): void;
}
export declare function createSessionStartHookContext(
  options: CreateSessionStartHookContextOptions
): SessionStartContext;
export declare function createUserPromptSubmitHookContext(
  options: CreateUserPromptSubmitHookContextOptions
): UserPromptSubmitContext;
export declare function createPreToolUseHookContext(
  options: CreatePreToolUseHookContextOptions
): ToolUseContext;
export declare function createPostToolUseHookContext(
  options: CreatePostToolUseHookContextOptions
): ToolUseContext;
export declare function createPreIterationHookContext(
  options: CreatePreIterationHookContextOptions
): IterationContext;
export declare function createPostIterationHookContext(
  options: CreatePostIterationHookContextOptions
): IterationContext;
export declare function createPreCompactionHookContext(
  options: CreatePreCompactionHookContextOptions
): PreCompactionContext;
export declare function createPostCompactionHookContext(
  options: CreatePostCompactionHookContextOptions
): PostCompactionContext;
export declare function createNotificationHookContext(
  options: CreateNotificationHookContextOptions
): NotificationContext;
export declare function createStopHookContext(options: CreateStopHookContextOptions): StopContext;
export declare function applyToolCallDecision(
  decision: ToolCallDecision,
  ctx: ToolUseContext
): Promise<HookDispatchResult>;
export declare function applyToolResultDecision(
  decision: ToolResultDecision,
  ctx: ToolUseContext
): Promise<HookDispatchResult>;
export declare function applyInputDecision(
  decision: InputDecision,
  ctx: UserPromptSubmitContext
): Promise<HookDispatchResult>;
export declare function applyHookDecision(
  event: HookEvent,
  decision: HookDecision | ToolCallDecision | ToolResultDecision | InputDecision,
  ctx: HookContext
): Promise<HookDispatchResult>;
export declare function dispatchHook(options: {
  registry: HookRegistry;
  event: HookEvent;
  ctx: HookContext;
  disposeRun?: DisposeRun;
}): Promise<HookDispatchResult>;
