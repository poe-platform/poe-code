import type { ChatMessage, ForkResult, NormalizedTool, Tool, ToolCallRecord } from "./types.js";
import type { McpSpawnServer } from "@poe-code/agent-spawn";

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
  | { type: "tool_error"; error: string };

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
  signal: AbortSignal;
  fork(prompt: string): Promise<ForkResult>;
  complete: IterationComplete;
  runHook: IterationRunHook;
};

export type IterationCompactionOptions = {
  threshold?: number;
  contextWindow?: number;
  keepLastTurns?: number;
  summarise?(messages: ChatMessage[]): string | Promise<string>;
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
  signal: AbortSignal;
};

export type PostCompactionContext = {
  tokenCount: number;
  summary: string;
  droppedMessages: ChatMessage[];
  messages: ChatMessage[];
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

export type HookDecision = "skip" | "abort" | { reject: string } | void;

export type AgentPlugin = {
  name: string;
  tools?: Tool[];
  prompt?(ctx: PromptContext): PromptContext | Promise<PromptContext>;
  hooks?: {
    sessionStart?(ctx: SessionStartContext): HookDecision | void | Promise<HookDecision | void>;
    userPromptSubmit?(
      ctx: UserPromptSubmitContext
    ): HookDecision | void | Promise<HookDecision | void>;
    preToolUse?(ctx: ToolUseContext): HookDecision | void | Promise<HookDecision | void>;
    postToolUse?(ctx: ToolUseContext): HookDecision | void | Promise<HookDecision | void>;
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
