import {
  agent as composableAgent,
  openaiChatCompletionsPlugin as composableOpenaiChatCompletionsPlugin,
  openaiResponsesPlugin as composableOpenaiResponsesPlugin,
  systemPromptPlugin as composableSystemPromptPlugin
} from "@poe-code/poe-agent";

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
export type SpawnMode = "yolo" | "auto" | "edit" | "read";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ToolResultPart[];
  reasoning_content?: string;
  reasoning?: string;
  thinking?: Array<{ text: string; signature?: string }>;
  redacted_thinking?: Array<{ data: string }>;
  reasoning_details?: unknown[];
  name?: string;
  toolCallId?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export type AcpModelRequestMessage = Omit<ChatMessage, "toolCallId"> & {
  tool_call_id?: string;
};

export type ToolCallRecord = {
  intentId: string;
  tool: string;
  args: unknown;
  status: "success" | "error";
  result?: unknown;
  error?: string;
};

export type RunResult = {
  output: string;
  stdout: string;
  summary?: string;
  messages: ChatMessage[];
  toolCalls: ToolCallRecord[];
  usage?: UsageInfo;
  logFile?: string;
  exitCode: number;
  stderr: string;
};

export type UsageInfo = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheCreationTokens: number;
};

export type ForkResult = {
  output: string;
  messages: ChatMessage[];
};

export type ToolContext = {
  fork(prompt: string): Promise<ForkResult>;
  spawn(prompt: string): Promise<{ output: string; messages: ChatMessage[] }>;
  signal: AbortSignal;
  notify?(notification: { event: string; message?: string; data?: unknown }): void | Promise<void>;
};

export type ToolEvent =
  | { type: "message.delta"; content: string }
  | { type: "progress"; message: string };

export type Tool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  visibility?: "model" | "skill" | "internal";
  policy?: {
    read: boolean;
    edit: boolean;
    validate?(args: unknown, mode: SpawnMode): string | void | Promise<string | void>;
  };
  call(
    args: unknown,
    context: ToolContext
  ): ToolResult | Promise<ToolResult> | AsyncGenerator<ToolEvent, ToolResult, void>;
};

export type McpServerConfig = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
  visibility?: "model" | "skill";
};

export type McpServerMap = Record<string, Omit<McpServerConfig, "name" | "visibility">>;

export type PromptContext = {
  baseSystemPrompt?: string;
  system?: string;
  userPrompt: string;
  metadata?: Record<string, unknown>;
};

export type Logger = {
  debug?(message: string, data?: unknown): void;
  info?(message: string, data?: unknown): void;
  warn?(message: string, data?: unknown): void;
  error?(message: string, data?: unknown): void;
};

export type ProviderStreamEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string; signature?: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "reasoning_details"; payload: unknown }
  | { type: "tool_use_delta"; id: string; name?: string; argsDelta?: string }
  | { type: "tool_use_complete"; id: string; name: string; args: unknown }
  | { type: "tool_use_json_parse_error"; id: string; raw: string; error: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; cachedTokens: number; cacheCreationTokens: number }
  | { type: "stop"; reason: "end_turn" | "tool_use" | "max_tokens" | "error" };

export type AcpModel = {
  complete(request: {
    messages: AcpModelRequestMessage[];
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
    signal: AbortSignal;
  }): Promise<{ events: AsyncIterable<ProviderStreamEvent> }>;
};

export type ProviderContext = {
  fetch: typeof fetch;
  signal?: AbortSignal;
  logger?: Logger;
  options: unknown;
};

export type Provider = {
  name: string;
  supports(modelId: string): boolean;
  createModel(modelId: string, context: ProviderContext): AcpModel | Promise<AcpModel>;
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

export type IterationContext = {
  iterationNumber: number;
  tokenCount: number;
  messages: ChatMessage[];
  signal: AbortSignal;
  fork(prompt: string): Promise<ForkResult>;
  complete(messages: ChatMessage[]): Promise<string>;
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

export type PluginApi = {
  addTool(tool: Tool): void;
  addMcp(config: McpServerConfig): void;
  getTool(name: string): Tool | undefined;
};

export type AgentPlugin = {
  name: string;
  tools?: Tool[];
  providers?: Provider[];
  prompt?(context: PromptContext): PromptContext | Promise<PromptContext>;
  hooks?: {
    sessionStart?(context: SessionStartContext): HookDecision | Promise<HookDecision>;
    userPromptSubmit?(context: UserPromptSubmitContext): HookDecision | Promise<HookDecision>;
    preToolUse?(context: ToolUseContext): HookDecision | Promise<HookDecision>;
    postToolUse?(context: ToolUseContext): HookDecision | Promise<HookDecision>;
    preIteration?(context: IterationContext): HookDecision | Promise<HookDecision>;
    postIteration?(context: IterationContext): HookDecision | Promise<HookDecision>;
    preCompaction?(context: PreCompactionContext): HookDecision | Promise<HookDecision>;
    postCompaction?(context: PostCompactionContext): HookDecision | Promise<HookDecision>;
    notification?(context: NotificationContext): HookDecision | Promise<HookDecision>;
    stop?(context: StopContext): HookDecision | Promise<HookDecision>;
  };
  setup?(api: PluginApi): void | Promise<void>;
  dispose?(): void | Promise<void>;
};

export type AcpEvent =
  | { type: "message.delta"; content: string }
  | { type: "tool.intent"; intentId: string; tool: string; args: unknown }
  | { type: "tool.result"; intentId: string; result: unknown }
  | { type: "tool.error"; intentId: string; error: string }
  | { type: "progress"; message: string }
  | { type: "usage"; usage: UsageInfo }
  | { type: "session.complete"; result: RunResult }
  | { type: "session.error"; error: Error };

export type AgentRunOptions = {
  signal?: AbortSignal;
  resume?: RunResult;
  skills?: string[];
  maxIterations?: number;
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  cwd?: string;
  baseSystemPrompt?: string;
  acpModel?: AcpModel;
  onStdout?: (chunk: string) => void;
  logPath?: string;
  env?: Record<string, string | undefined>;
};

export type AgentSession = {
  events: AsyncIterable<AcpEvent>;
  acknowledge(intentId: string, result: { status: "success" | "error"; result: unknown }): void;
  dispose(): Promise<void>;
};

export type AgentBuilder = {
  model(model: string): AgentBuilder;
  use(plugin: AgentPlugin): AgentBuilder;
  tools(...tools: Tool[]): AgentBuilder;
  mcp(configs: McpServerMap): AgentBuilder;
  mcp(...configs: McpServerConfig[]): AgentBuilder;
  acp(prompt: string, options?: AgentRunOptions): Promise<AgentSession>;
  run(prompt: string, options?: AgentRunOptions): Promise<RunResult>;
  stream(prompt: string, options?: AgentRunOptions): AsyncIterable<AcpEvent>;
};

export type OpenaiProviderPluginOptions = {
  baseUrl?: string;
  apiKey?: string;
  organization?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
};

export type OpenaiResponsesPluginOptions = OpenaiProviderPluginOptions & {
  project?: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  reasoningSummary?: "auto" | "concise" | "detailed";
  include?: string[];
};

export const agent = composableAgent as unknown as () => AgentBuilder;
export const openaiChatCompletionsPlugin = composableOpenaiChatCompletionsPlugin as unknown as (
  options?: OpenaiProviderPluginOptions
) => AgentPlugin;
export const openaiResponsesPlugin = composableOpenaiResponsesPlugin as unknown as (
  options?: OpenaiResponsesPluginOptions
) => AgentPlugin;
export const systemPromptPlugin = composableSystemPromptPlugin as unknown as () => AgentPlugin;
