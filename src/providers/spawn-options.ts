import type { AcpMiddleware, McpSpawnConfig, SpawnMode } from "@poe-code/agent-spawn";
import type { RuntimeOverrideOptions } from "@poe-code/agent-harness-tools";
import type { HookBridgeOptions } from "../sdk/types.js";

export interface SpawnCommandOptions {
  prompt: string;
  args?: string[];
  model?: string;
  mode?: SpawnMode;
  env?: Record<string, string>;
  mcpServers?: McpSpawnConfig;
  skills?: string[];
  hooks?: HookBridgeOptions;
  resumeThreadId?: string;
  logDir?: string;
  logFileName?: string;
  logContent?: boolean;
  activityTimeoutMs?: number;
  captureOtel?: boolean;
  captureOtelContent?: boolean;
  middlewares?: AcpMiddleware[];
  cwd?: string;
  useStdin?: boolean;
  interactive?: boolean;
  signal?: AbortSignal;
  runtime?: RuntimeOverrideOptions["runtime"];
  runtimeImage?: string;
  runtimeTemplate?: string;
  runtimeConfigCwd?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
  runnerSync?: RuntimeOverrideOptions["runnerSync"];
}

export type ProviderSpawnOptions<Extra extends Record<string, unknown> = Record<string, never>> =
  SpawnCommandOptions & Extra;

export interface ModelConfigureOptions {
  model: string;
}

export type EmptyProviderOptions = Record<string, never>;
