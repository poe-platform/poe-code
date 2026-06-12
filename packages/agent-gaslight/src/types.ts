import type { SpawnMode, SpawnOptions, SpawnResult, SpawnUsage } from "@poe-code/agent-spawn";

export interface GaslightFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  stat(path: string): Promise<{ isFile(): boolean }>;
}

export type GaslightSpawn = (agent: string, options: SpawnOptions) => Promise<SpawnResult>;

export type GaslightEvent =
  | { type: "round.started"; round: number; total: number; prompt: string }
  | { type: "round.finished"; round: number; total: number; summary: string };

export interface GaslightRound {
  prompt: string;
  summary: string;
  threadId?: string;
}

export interface GaslightResult {
  rounds: GaslightRound[];
  usage?: SpawnUsage;
}

export interface GaslightOptions {
  planPath: string;
  agent: string;
  model?: string;
  mode?: Exclude<SpawnMode, "auto">;
  cwd?: string;
  homeDir?: string;
  prompt?: string;
  followups?: string[];
  onEvent?: (event: GaslightEvent) => void;
  signal?: AbortSignal;
  fs?: GaslightFileSystem;
  spawn?: GaslightSpawn;
}

export interface GaslightConfig {
  prompt: string;
  followups: string[];
  path: string;
}
