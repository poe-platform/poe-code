import type { SpawnMode } from "@poe-code/agent-spawn";

export interface SpawnCommandOptions {
  prompt: string;
  args?: string[];
  model?: string;
  mode?: SpawnMode;
  cwd?: string;
  useStdin?: boolean;
  interactive?: boolean;
}

export type ProviderSpawnOptions<
  Extra extends Record<string, unknown> = Record<string, never>
> = SpawnCommandOptions & Extra;

export interface ModelConfigureOptions {
  model: string;
}

export type EmptyProviderOptions = Record<string, never>;
