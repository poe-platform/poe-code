export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
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
  toolCalls: ToolCallRecord[];
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

export type AcpEvent =
  | { type: "message.delta"; content: string }
  | { type: "tool.intent"; intentId: string; tool: string; args: unknown }
  | { type: "tool.result"; intentId: string; result: unknown }
  | { type: "tool.error"; intentId: string; error: string }
  | { type: "fork.start"; forkId: string; prompt: string }
  | { type: "fork.complete"; forkId: string; result: ForkResult }
  | { type: "fork.error"; forkId: string; error: string }
  | { type: "progress"; message: string }
  | { type: "session.complete"; result: RunResult }
  | { type: "session.error"; error: Error };

export type AcpHost = {
  handle(intent: ToolIntent): Promise<ToolAckResult>;
  fork(request: ForkRequest): Promise<ForkResult>;
  spawn(prompt: string): Promise<RunOutput>;
};

export type ToolContext = {
  fork(prompt: string): Promise<ForkResult>;
  spawn(prompt: string): Promise<RunOutput>;
  signal: AbortSignal;
};

export type ToolEvent =
  | { type: "message.delta"; content: string }
  | { type: "progress"; message: string };

export type Tool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  visibility?: "model" | "skill" | "internal";
  call(
    args: unknown,
    ctx: ToolContext,
  ): unknown | Promise<unknown> | AsyncGenerator<ToolEvent, unknown, void>;
};

export type NormalizedTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  visibility: "model" | "skill" | "internal";
  invoke(args: unknown, ctx: ToolContext): AsyncGenerator<ToolEvent, unknown, void>;
};
