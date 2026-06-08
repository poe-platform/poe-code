import type { WorkflowFileStat, WorkflowFileSystem } from "@poe-code/agent-harness-tools";

export interface ExperimentFileStat extends WorkflowFileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  mtimeMs: number;
}

export interface ExperimentLinkStat {
  isSymbolicLink(): boolean;
}

export interface ExperimentFileSystem extends WorkflowFileSystem {
  writeFile(
    path: string,
    content: string,
    options?: { encoding?: BufferEncoding; flag?: string; mode?: number }
  ): Promise<void>;
  readdir(path: string): Promise<string[]>;
  appendFile(path: string, content: string): Promise<void>;
  stat(path: string): Promise<ExperimentFileStat>;
  lstat(path: string): Promise<ExperimentLinkStat>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface ExperimentGit {
  reset(commitHash: string, cwd: string): Promise<void>;
  currentHash(cwd: string): Promise<string>;
}

export type ExecFn = (
  command: string,
  options?: {
    cwd?: string;
    timeout?: number;
  }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export type MetricDirection = "minimize" | "maximize" | "stable";

export interface MetricDef {
  name: string;
  script: string;
  direction: MetricDirection;
  delta?: number;
}

export interface AgentRunInput {
  agent: string;
  prompt: string;
  cwd: string;
  model?: string;
  runtime?: "host" | "docker" | "e2b";
  runtimeImage?: string;
  runtimeTemplate?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
  runnerSync?: "both" | "upload" | "none";
  signal?: AbortSignal;
  logDir?: string;
  logFileName?: string;
}

export interface AgentRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExperimentRunOptions {
  cwd: string;
  homeDir: string;
  docPath: string;
  agent?: string | string[];
  runtime?: "host" | "docker" | "e2b";
  runtimeImage?: string;
  runtimeTemplate?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
  runnerSync?: "both" | "upload" | "none";
  maxExperiments?: number;
  fs?: ExperimentFileSystem;
  git?: ExperimentGit;
  exec?: ExecFn;
  runAgent?: (input: AgentRunInput) => Promise<AgentRunResult>;
  onExperimentStart?: (index: number, agent: string) => void;
  onBaselineCollected?: (baseline: Record<string, number>) => void;
  onCommit?: (commitHash: string) => void;
  onMetricResult?: (metric: MetricDef, result: EvalResult) => void;
  onReset?: (targetHash: string) => void;
  onExperimentComplete?: (index: number, entry: JournalEntry) => void;
  signal?: AbortSignal;
}

export type ExperimentStopReason = "max_experiments" | "cancelled";

export interface ExperimentRunResult {
  stopReason: ExperimentStopReason;
  docPath: string;
  experimentsCompleted: number;
  experimentsKept: number;
  totalDurationMs: number;
}

export interface EvalResult {
  score: number | null;
  passed: boolean;
  output: string;
}

export interface JournalEntry {
  commit: string;
  status: "keep" | "discard";
  scores?: Record<string, number>;
  output: string;
  agentOutput: string;
  durationMs: number;
  timestamp: string;
}

export interface RunConfig {
  prompt: string;
}
