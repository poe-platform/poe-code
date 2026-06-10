import type { SpawnMode } from "@poe-code/agent-spawn";

export type ToolResultTextPart = {
  type: "text";
  text: string;
};

export type ToolResultImagePart = {
  type: "image";
  mimeType: string;
  data: string;
};

export type ToolResultErrorPart = {
  type: "error";
  code: string;
  message: string;
  retriable: boolean;
};

export type ToolResultPart = ToolResultTextPart | ToolResultImagePart | ToolResultErrorPart;

export type ToolResult = string | ToolResultPart | ToolResultPart[];

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ToolResultPart[];
  reasoning_content?: string;
  reasoning?: string;
  thinking?: Array<{
    text: string;
    signature?: string;
  }>;
  redacted_thinking?: Array<{
    data: string;
  }>;
  reasoning_details?: unknown[];
  name?: string;
  toolCallId?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

export type ToolCallRecord = {
  intentId: string;
  tool: string;
  args: unknown;
  status: "success" | "error";
  result?: unknown;
  error?: string;
};

export type RunContextSnapshot = {
  messages: ChatMessage[];
  toolCalls: ToolCallRecord[];
};

export type RunOutput = {
  output: string;
  messages: ChatMessage[];
};

export type RunResult = RunOutput & {
  stdout: string;
  summary?: string;
  toolCalls: ToolCallRecord[];
  usage?: UsageInfo;
  logFile?: string;
  exitCode: number;
  stderr: string;
};

export type ToolIntent = {
  intentId: string;
  tool: string;
  args: unknown;
};

export type ToolAckResult = {
  status: "success" | "error";
  result: unknown;
};

export type ForkRequest = {
  forkId: string;
  prompt: string;
  context: RunContextSnapshot;
};

export type ForkResult = {
  output: string;
  messages: ChatMessage[];
};

export type UsageInfo = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheCreationTokens: number;
};

export type AcpEvent =
  | { type: "message.delta"; content: string }
  | { type: "tool.intent"; intentId: string; tool: string; args: unknown }
  | { type: "tool.result"; intentId: string; result: unknown }
  | { type: "tool.error"; intentId: string; error: string }
  | { type: "fork.start"; forkId: string; prompt: string }
  | { type: "fork.complete"; forkId: string; result: ForkResult }
  | { type: "fork.error"; forkId: string; error: string }
  | { type: "progress"; message: string }
  | { type: "usage"; usage: UsageInfo }
  | { type: "session.complete"; result: RunResult }
  | { type: "session.error"; error: Error };

export type AcpHost = {
  setEmit?(emit: (event: AcpEvent) => void): void;
  handle(intent: ToolIntent): Promise<ToolAckResult>;
  fork(request: ForkRequest): Promise<ForkResult>;
  spawn(prompt: string): Promise<RunOutput>;
};

export type ToolContext = {
  fork(prompt: string): Promise<ForkResult>;
  spawn(prompt: string): Promise<RunOutput>;
  signal: AbortSignal;
  notify?(notification: { event: string; message?: string; data?: unknown }): void | Promise<void>;
};

export type ToolEvent =
  | { type: "message.delta"; content: string }
  | { type: "progress"; message: string };

export type ToolPolicy = {
  read: boolean;
  edit: boolean;
  validate?(args: unknown, mode: SpawnMode): string | void | Promise<string | void>;
};

export type Tool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  visibility?: "model" | "skill" | "internal";
  policy?: ToolPolicy;
  call(
    args: unknown,
    ctx: ToolContext
  ): ToolResult | Promise<ToolResult> | AsyncGenerator<ToolEvent, ToolResult, void>;
};

export type NormalizedTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  visibility: "model" | "skill" | "internal";
  policy?: ToolPolicy;
  invoke(args: unknown, ctx: ToolContext): AsyncGenerator<ToolEvent, ToolResult, void>;
};
