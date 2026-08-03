import type { SpawnMode, SpawnOptions, SpawnResult, SpawnUsage } from "@poe-code/agent-spawn";
import type {
  AgentTraceFileSystem,
  AgentTraceSource,
  CollectHumanPromptsOptions,
  CollectHumanPromptsResult
} from "@poe-code/agent-traces";

export type GaslightFileSystem = AgentTraceFileSystem;

export type GaslightArchiveFileSystem = GaslightFileSystem & {
  lstat?(path: string): Promise<{ isSymbolicLink(): boolean }>;
  rename?(oldPath: string, newPath: string): Promise<void>;
  rmdir?(path: string): Promise<void>;
};

export type GaslightSpawn = (agent: string, options: SpawnOptions) => Promise<SpawnResult>;

export type GaslightEvent =
  | {
      type: "round.started";
      round: number;
      total: number;
      prompt: string;
      planPath: string;
      planIndex: number;
      totalPlans: number;
    }
  | {
      type: "round.finished";
      round: number;
      total: number;
      summary: string;
      planPath: string;
      planIndex: number;
      totalPlans: number;
    };

export interface GaslightRound {
  prompt: string;
  summary: string;
  threadId?: string;
}

export interface GaslightResult {
  rounds: GaslightRound[];
  plans: GaslightPlanResult[];
  durationMs: number;
  usage?: SpawnUsage;
}

export interface GaslightPlanResult {
  planPath: string;
  archivedPath?: string;
  rounds: GaslightRound[];
  durationMs: number;
  usage?: SpawnUsage;
}

export interface GaslightOptions {
  planPaths: string[];
  agent?: string;
  model?: string;
  mode?: SpawnMode;
  archive?: boolean;
  cwd?: string;
  homeDir?: string;
  configPath?: string;
  setup?: string;
  prompt?: string;
  followups?: string[];
  teardown?: string;
  vars?: Record<string, string>;
  onEvent?: (event: GaslightEvent) => void;
  signal?: AbortSignal;
  fs?: GaslightFileSystem;
  spawn?: GaslightSpawn;
}

export interface GaslightConfig {
  agent?: string;
  setup?: string;
  prompt: string;
  followups: string[];
  teardown?: string;
  vars?: Record<string, string>;
  archive?: boolean;
  path: string;
}

export type GaslightCollectHumanPrompts = (
  options: CollectHumanPromptsOptions
) => Promise<CollectHumanPromptsResult>;

export type GaslightIngestEvent =
  | { type: "traces.discovered"; count: number }
  | { type: "prompts.extracted"; traces: number; prompts: number }
  | { type: "analysis.started"; agent: string; dataPath: string }
  | { type: "config.written"; path: string };

export interface GaslightIngestOptions {
  sources?: AgentTraceSource[];
  analysisAgent: string;
  model?: string;
  cwd?: string;
  homeDir?: string;
  since?: string | Date;
  limit?: number;
  allWorkspaces?: boolean;
  outputPath?: string;
  keepDataPath?: string;
  dryRun?: boolean;
  onEvent?: (event: GaslightIngestEvent) => void;
  fs?: GaslightFileSystem;
  spawn?: GaslightSpawn;
  collectHumanPrompts?: GaslightCollectHumanPrompts;
}

export interface GaslightIngestResult {
  outputPath: string;
  dataPath: string;
  promptCount: number;
  traceCount: number;
}
