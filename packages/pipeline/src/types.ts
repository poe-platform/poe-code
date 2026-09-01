export type PipelineStatus = "open" | "done" | "failed";
export type PipelineFinalizationStatus = "pending" | "teardown_completed" | "completed";
export const PIPELINE_STEP_MODES = ["yolo", "auto", "edit", "read"] as const;
export type StepMode = (typeof PIPELINE_STEP_MODES)[number];

export interface StepHooks {
  from: string;
  strategy?: "auto" | "symlink" | "transform";
  scope?: "project" | "user" | "merged";
}

export interface McpSpawnServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type McpSpawnConfig = Record<string, McpSpawnServer>;

export interface StepDefinition {
  mode?: StepMode;
  prompt: string;
  agent?: string;
  model?: string;
  skills?: string[];
  hooks?: StepHooks;
}

export interface StepDefinitionOverride {
  mode?: StepMode;
  prompt?: string;
  agent?: string;
  model?: string;
  skills?: string[];
  hooks?: StepHooks;
}

export type ResolvedStepDefinitions = Record<string, StepDefinition>;
export type StepDefinitionOverrides = Record<string, StepDefinitionOverride>;

export interface ResolvedStepsConfig {
  steps: ResolvedStepDefinitions;
  setup?: StepDefinition;
  teardown?: StepDefinition;
}

export interface PipelineTask {
  id: string;
  title: string;
  prompt: string;
  status: PipelineStatus | Record<string, PipelineStatus>;
}

export interface PipelinePlan {
  finalization?: PipelineFinalizationStatus;
  extends?: string;
  stepOverrides?: StepDefinitionOverrides;
  tasks: PipelineTask[];
  vars?: Record<string, string>;
  setup?: StepDefinition | null;
  teardown?: StepDefinition | null;
  mcp?: McpSpawnConfig;
}

export interface PipelineConfig {
  plan_directory?: string;
  [key: string]: unknown;
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
    options?: { encoding?: BufferEncoding; flag?: string }
  ): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<PipelineFileStat>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  realpath?(path: string): Promise<string>;
}

export interface AgentRunInput {
  agent: string;
  prompt: string;
  mode?: StepMode;
  cwd: string;
  logDir?: string;
  logFileName?: string;
  model?: string;
  skills?: string[];
  hooks?: StepHooks;
  mcpServers?: McpSpawnConfig;
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
      kind: "completed";
    };

export interface TaskProgress {
  taskId: string;
  taskTitle: string;
  stepName?: string;
  taskIndex: number;
  totalTasks: number;
  stepIndex?: number;
  totalSteps?: number;
  phase?: "setup" | "teardown";
}

export interface TaskCompletion extends TaskProgress {
  durationMs: number;
  success: boolean;
  usage?: AgentRunUsage;
  taskCompleted?: boolean;
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
  archive?: boolean;
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
  onTaskComplete?: (progress: TaskCompletion) => void;
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
