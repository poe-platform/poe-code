import type { McpSpawnConfig } from "./spawn-types.js";
import type { AcpModel } from "./acp-model.js";
import { type AgentHostOptions } from "./agent-host.js";
import type { FileAwarenessTracker } from "./file-awareness.js";
import type { AgentPlugin, McpServerConfig } from "./plugin-types.js";
import type { AcpEvent, RunResult, Tool, ToolAckResult } from "./types.js";
export type AgentRunOptions = {
  signal?: AbortSignal;
  resume?: Pick<RunResult, "messages">;
  skills?: string[];
  activeSkills?: string[];
  maxIterations?: number;
  acpModel?: AcpModel;
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  cwd?: string;
  baseSystemPrompt?: string;
  createSpawnSession?: AgentHostOptions["createSpawnSession"];
  onStdout?: (chunk: string) => void;
  logPath?: string;
  env?: Record<string, string | undefined>;
  fileAwareness?: FileAwarenessTracker;
  onPromptSubmitted?: (prompt: string) => void | Promise<void>;
};
export type AcpSession = {
  events: AsyncIterable<AcpEvent>;
  acknowledge(intentId: string, result: ToolAckResult): void;
  dispose(): Promise<void>;
};
export type AgentBuilder = {
  model(model: string): AgentBuilder;
  use(plugin: AgentPlugin): AgentBuilder;
  tools(...tools: Tool[]): AgentBuilder;
  mcp(configs: McpSpawnConfig): AgentBuilder;
  mcp(...configs: McpServerConfig[]): AgentBuilder;
  acp(prompt: string, options?: AgentRunOptions): Promise<AcpSession>;
  run(prompt: string, options?: AgentRunOptions): Promise<RunResult>;
  stream(prompt: string, options?: AgentRunOptions): AsyncIterable<AcpEvent>;
};
export declare function agent(): AgentBuilder;
export declare function normalizeNonEmptyString(
  value: string | null | undefined
): string | undefined;
export declare function assertPositiveIntegerOption(value: unknown, key: string): void;
