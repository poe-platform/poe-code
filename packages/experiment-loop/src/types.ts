export interface ExperimentFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ isFile(): boolean; mtimeMs: number }>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  appendFile(path: string, content: string): Promise<void>;
}

export interface ExperimentGit {
  commitAll(message: string, cwd: string): Promise<string>;
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
  signal?: AbortSignal;
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
  model?: string;
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
  status: "keep" | "discard" | "crash";
  score: number | null;
  output: string;
  durationMs: number;
  timestamp: string;
}

export interface RunConfig {
  prompt: string;
}
