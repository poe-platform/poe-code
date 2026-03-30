export type PipelineStatus = "open" | "done" | "failed";
export type StepMode = "yolo" | "edit" | "read";

export interface StepDefinition {
  mode: StepMode;
  instruction: string;
  agent?: string;
  model?: string;
}

export type ResolvedStepDefinitions = Record<string, StepDefinition>;

export interface PipelineTask {
  id: string;
  title: string;
  prompt: string;
  status: PipelineStatus | Record<string, PipelineStatus>;
}

export interface PipelinePlan {
  tasks: PipelineTask[];
}

export interface PipelineConfig {
  planPath?: string;
}

export interface PipelineFileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  mtimeMs: number;
}

export interface PipelineFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: BufferEncoding }
  ): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<PipelineFileStat>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

export interface AgentRunInput {
  agent: string;
  prompt: string;
  mode: StepMode;
  cwd: string;
  logDir?: string;
  model?: string;
  signal?: AbortSignal;
}

export interface AgentRunUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
}

export interface AgentRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  threadId?: string;
  sessionId?: string;
  usage?: AgentRunUsage;
}

export interface PipelineMetrics {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  tasksCompleted: number;
  tasksFailed: number;
  stepsCompleted: number;
}

export type ExecutionSelection =
  | {
      kind: "run";
      task: PipelineTask;
      stepName?: string;
    }
  | {
      kind: "blocked";
      task: PipelineTask;
      stepName?: string;
    }
  | {
      kind: "completed";
    };

export interface TaskProgress {
  taskId: string;
  taskTitle: string;
  stepName?: string;
  index: number;
  total: number;
}

export interface PlanSummary {
  planPath: string;
  done: number;
  failed: number;
  open: number;
  total: number;
}

export interface PipelineRunOptions {
  agent: string;
  cwd: string;
  homeDir: string;
  logDir?: string;
  model?: string;
  plan?: string;
  planDirectory?: string;
  task?: string;
  maxRuns?: number;
  assumeYes?: boolean;
  fs?: PipelineFileSystem;
  runAgent?: (input: AgentRunInput) => Promise<AgentRunResult>;
  selectPlan?: (input: {
    message: string;
    options: Array<{ label: string; value: string }>;
  }) => Promise<string | null>;
  promptForPath?: (input: { message: string; placeholder: string }) => Promise<string | null>;
  onPlanResolved?: (summary: PlanSummary) => void;
  onTaskStart?: (progress: TaskProgress) => void;
  onTaskComplete?: (progress: TaskProgress & {
    durationMs: number;
    success: boolean;
    usage?: AgentRunUsage;
  }) => void;
  onPlanReloadError?: (error: Error) => void;
  signal?: AbortSignal;
}

export interface PipelineRunResult {
  stopReason: "completed" | "failed" | "cancelled" | "max_runs" | "nothing_to_run";
  planPath: string;
  runsCompleted: number;
  totalDurationMs: number;
  metrics: PipelineMetrics;
  lastTaskId?: string;
  lastStepName?: string;
}
