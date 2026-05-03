import type { McpSpawnConfig, SpawnMode } from "@poe-code/agent-spawn";
import type { RuntimeOverrideOptions } from "@poe-code/agent-harness-tools";

export interface SpawnCommandOptions {
  prompt: string;
  args?: string[];
  model?: string;
  mode?: SpawnMode;
  mcpServers?: McpSpawnConfig;
  logDir?: string;
  activityTimeoutMs?: number;
  cwd?: string;
  useStdin?: boolean;
  interactive?: boolean;
  runtime?: RuntimeOverrideOptions["runtime"];
  runtimeImage?: string;
  runtimeTemplate?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
}

export type ProviderSpawnOptions<
  Extra extends Record<string, unknown> = Record<string, never>
> = SpawnCommandOptions & Extra;

export interface ModelConfigureOptions {
  model: string;
}

export type EmptyProviderOptions = Record<string, never>;
