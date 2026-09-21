import type {
  SpawnConfig,
  AcpSpawnConfig,
  CliSpawnConfig,
  SpawnMode,
  McpSpawnConfig
} from "./types.js";
export * from "./types.js";
export interface SpawnableAgent {
  id: string;
  name: string;
  label: string;
  summary: string;
  aliases: string[];
  binaryName?: string;
  supportsStdinPrompt: boolean;
  supportsMcpSpawn: boolean;
  config?: SpawnConfig;
  acpConfig?: AcpSpawnConfig;
}
export declare const allSpawnConfigs: readonly SpawnConfig[];
export declare function getSpawnConfig(input: string): SpawnConfig | undefined;
export declare function getAcpSpawnConfig(input: string): AcpSpawnConfig | undefined;
/**
 * CLI agents support a mode when their spawn config defines it. ACP and custom
 * spawn paths have a live permission channel, so every mode is accepted there.
 */
export declare function supportsSpawnMode(input: string, mode: SpawnMode): boolean;
export declare function supportsMcpAtSpawn(input: string): boolean;
export declare function listMcpSupportedAgents(): string[];
export declare function listSpawnableAgents(): readonly SpawnableAgent[];
export declare function resolveSpawnableAgent(input: string): SpawnableAgent | undefined;
export interface BuildSpawnArgsOptions {
  prompt: string;
  model?: string;
  mode?: SpawnMode;
  args?: string[];
  mcpServers?: McpSpawnConfig;
  resumeThreadId?: string;
  cwd?: string;
  useStdin?: boolean;
}
export interface BuildSpawnArgsResult {
  binaryName: string;
  args: string[];
  displayArgs: string[];
  env?: Record<string, string>;
}
export declare function buildSpawnArgs(
  agentId: string,
  options: BuildSpawnArgsOptions
): BuildSpawnArgsResult;
export type SpawnEnvironment = Record<string, string | undefined>;
export declare function mergeSpawnEnvironment(
  ...sources: Array<SpawnEnvironment | NodeJS.ProcessEnv | undefined>
): Record<string, string>;
interface JsonMcpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
}
export declare function toJsonMcpServers(servers: McpSpawnConfig): Record<string, JsonMcpServer>;
export declare function serializeJsonMcpArgs(servers: McpSpawnConfig): string[];
export declare function serializeOpenCodeMcpEnv(servers: McpSpawnConfig): Record<string, string>;
export declare function serializeCodexMcpArgs(servers: McpSpawnConfig): string[];
export declare function serializeGooseMcpArgs(servers: McpSpawnConfig): string[];
export interface ResolvedSpawnConfig {
  agentId: string;
  binaryName?: string;
  spawnConfig?: SpawnConfig;
}
export declare function resolveConfig(
  agentId: string,
  env?: Readonly<Record<string, string | undefined>>
): ResolvedSpawnConfig;
export { createSpawnRetry, calculateBackoffMs, defaultIsRetryable } from "./retry.js";
export type { SpawnRetryOptions, SpawnHandle, SpawnRetryFunction } from "./retry.js";
export { createSpawnParallel, SpawnParallelError } from "./parallel.js";
export type {
  SpawnParallelTuple,
  SpawnParallelThunk,
  SpawnParallelCall,
  SpawnParallelOptions
} from "./parallel.js";
export { runCommand } from "./run-command.js";
export type { CommandRunner, CommandRunnerOptions, CommandRunnerResult } from "./run-command.js";
export { adaptClaude, adaptCodex, adaptNative, getAdapter } from "./adapters.js";
export { readLines, applyMiddlewares } from "./stream.js";
