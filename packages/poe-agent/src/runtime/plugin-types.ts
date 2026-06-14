import type { ChatMessage, ForkResult, NormalizedTool, Tool, ToolCallRecord } from "./types.js";
import type { McpSpawnServer } from "@poe-code/agent-spawn";
import type { AcpModel } from "./acp-core.js";
import type { RunContextLogger } from "./run-context.js";

export type PromptContext = {
  baseSystemPrompt?: string;
  system?: string;
  userPrompt: string;
  metadata?: Record<string, unknown>;
};

export type McpServerConfig = McpSpawnServer & {
  name: string;
  visibility?: "model" | "skill";
};

export type Logger = RunContextLogger;

export type ProviderContext = {
  fetch: typeof fetch;
  signal?: AbortSignal;
  logger?: Logger;
  options: unknown;
};

export type Provider = {
  name: string;
  supports(modelId: string): boolean;
  createModel(modelId: string, ctx: ProviderContext): AcpModel | Promise<AcpModel>;
};

export type ProviderStreamEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string; signature?: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "reasoning_details"; payload: unknown }
  | { type: "tool_use_delta"; id: string; name?: string; argsDelta?: string }
  | { type: "tool_use_complete"; id: string; name: string; args: unknown }
  | { type: "tool_use_json_parse_error"; id: string; raw: string; error: string }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      cacheCreationTokens: number;
    }
  | { type: "stop"; reason: "end_turn" | "tool_use" | "max_tokens" | "error" };

export type PluginApi = {
  addTool(tool: Tool): void;
  addMcp(config: McpServerConfig): void;
  getTool(name: string): NormalizedTool | undefined;
};

export type ToolUseContext = {
  tool: string;
  args: unknown;
  intentId: string;
  result?: unknown;
  error?: string;
  session: Map<string, unknown>;
  messages: ChatMessage[];
  signal: AbortSignal;
};

export type HookEvent =
  | "sessionStart"
  | "userPromptSubmit"
  | "preToolUse"
  | "postToolUse"
  | "preIteration"
  | "postIteration"
  | "preCompaction"
  | "postCompaction"
  | "notification"
  | "stop";

export type HookDispatchResult =
  | { type: "continue" }
  | { type: "skip" }
  | { type: "tool_error"; error: string }
  | { type: "rewrite"; args: unknown }
  | {
      type: "replace";
      patch: {
        content?: unknown;
        details?: unknown;
        isError?: boolean;
      };
    }
  | { type: "handled"; response: string };

export type IterationComplete = (messages: ChatMessage[]) => Promise<string>;

export type HookContextByEvent = {
  sessionStart: SessionStartContext;
  userPromptSubmit: UserPromptSubmitContext;
  preToolUse: ToolUseContext;
  postToolUse: ToolUseContext;
  preIteration: IterationContext;
  postIteration: IterationContext;
  preCompaction: PreCompactionContext;
  postCompaction: PostCompactionContext;
  notification: NotificationContext;
  stop: StopContext;
};

export type HookContext = HookContextByEvent[HookEvent];

export type IterationRunHook = <TEvent extends HookEvent>(
  event: TEvent,
  ctx: HookContextByEvent[TEvent]
) => Promise<HookDispatchResult>;

export type IterationContext = {
  iterationNumber: number;
  tokenCount: number;
  messages: ChatMessage[];
  readFiles: ReadonlySet<string>;
  modifiedFiles: ReadonlySet<string>;
  signal: AbortSignal;
  fork(prompt: string): Promise<ForkResult>;
  complete: IterationComplete;
  runHook: IterationRunHook;
};

export type FileAwareness = {
  readFiles: ReadonlySet<string>;
  modifiedFiles: ReadonlySet<string>;
};

export type CompactSummarise = (
  messages: ChatMessage[],
  awareness: FileAwareness
) => string | Promise<string>;

export type IterationCompactionOptions = {
  threshold?: number;
  contextWindow?: number;
  keepLastTurns?: number;
  summarise?: ((messages: ChatMessage[]) => string | Promise<string>) | CompactSummarise;
};

export type IterationCompactionResult = {
  summary: string;
  droppedMessages: ChatMessage[];
};

export type SessionStartContext = {
  session: Map<string, unknown>;
  messages: ChatMessage[];
  signal: AbortSignal;
};

export type UserPromptSubmitContext = {
  prompt: string;
  messages: ChatMessage[];
  signal: AbortSignal;
};

export type PreCompactionContext = {
  tokenCount: number;
  force: boolean;
  messages: ChatMessage[];
  readFiles: ReadonlySet<string>;
  modifiedFiles: ReadonlySet<string>;
  signal: AbortSignal;
};

export type PostCompactionContext = {
  tokenCount: number;
  summary: string;
  droppedMessages: ChatMessage[];
  messages: ChatMessage[];
  readFiles: ReadonlySet<string>;
  modifiedFiles: ReadonlySet<string>;
  signal: AbortSignal;
};

export type NotificationContext = {
  event: string;
  message?: string;
  data?: unknown;
  messages: ChatMessage[];
  signal: AbortSignal;
};

export type StopContext = {
  status: "completed" | "error";
  output?: string;
  error?: Error;
  toolCalls: ToolCallRecord[];
  messages: ChatMessage[];
  signal: AbortSignal;
};

export type HookDecision = "skip" | "abort" | void;
export type LegacyRejectDecision = { reject: string };
export type ToolCallDecision =
  | HookDecision
  | LegacyRejectDecision
  | { block: true; reason: string }
  | { rewrite: { args: unknown } };
export type ToolResultDecision =
  | Exclude<HookDecision, "skip">
  | { replace: { content?: unknown; details?: unknown; isError?: boolean } };
export type InputDecision =
  | Exclude<HookDecision, "skip">
  | { action: "transform"; prompt: string }
  | { action: "handled"; response: string };

export type AgentPlugin = {
  name: string;
  tools?: Tool[];
  providers?: Provider[];
  prompt?(ctx: PromptContext): PromptContext | Promise<PromptContext>;
  hooks?: {
    sessionStart?(ctx: SessionStartContext): HookDecision | void | Promise<HookDecision | void>;
    userPromptSubmit?(
      ctx: UserPromptSubmitContext
    ): InputDecision | void | Promise<InputDecision | void>;
    preToolUse?(ctx: ToolUseContext): ToolCallDecision | void | Promise<ToolCallDecision | void>;
    postToolUse?(
      ctx: ToolUseContext
    ): ToolResultDecision | void | Promise<ToolResultDecision | void>;
    preIteration?(ctx: IterationContext): HookDecision | void | Promise<HookDecision | void>;
    postIteration?(ctx: IterationContext): HookDecision | void | Promise<HookDecision | void>;
    preCompaction?(ctx: PreCompactionContext): HookDecision | void | Promise<HookDecision | void>;
    postCompaction?(ctx: PostCompactionContext): HookDecision | void | Promise<HookDecision | void>;
    notification?(ctx: NotificationContext): HookDecision | void | Promise<HookDecision | void>;
    stop?(ctx: StopContext): HookDecision | void | Promise<HookDecision | void>;
  };
  setup?(api: PluginApi): void | Promise<void>;
  dispose?(): void | Promise<void>;
};
