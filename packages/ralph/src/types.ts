export interface RalphFileStat {
  isFile(): boolean;
  mtimeMs: number;
}

export interface RalphFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<RalphFileStat>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
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

export type OverbakeAction = "continue" | "abort";

export type RalphStopReason =
  | "completed"
  | "max_iterations"
  | "overbake_abort"
  | "cancelled";

export interface RalphRunResult {
  stopReason: RalphStopReason;
  docPath: string;
  iterationsCompleted: number;
  totalDurationMs: number;
}

export interface RalphRunOptions {
  agent: string;
  cwd: string;
  homeDir: string;
  model?: string;
  docPath: string;
  maxIterations: number;
  maxFailures?: number;
  fs?: RalphFileSystem;
  runAgent?: (input: AgentRunInput) => Promise<AgentRunResult>;
  promptOverbake?: (args: {
    consecutiveFailures: number;
    threshold: number;
  }) => Promise<OverbakeAction>;
  onIterationStart?: (iteration: number, maxIterations: number) => void;
  onIterationComplete?: (
    iteration: number,
    durationMs: number,
    success: boolean
  ) => void;
  onOverbakeWarning?: (consecutiveFailures: number, threshold: number) => void;
  signal?: AbortSignal;
}
