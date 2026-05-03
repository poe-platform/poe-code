export interface RalphFileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  mtimeMs: number;
}

export interface RalphFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<RalphFileStat>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
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
  signal?: AbortSignal;
  logDir?: string;
  logFileName?: string;
}

export interface AgentRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type RalphStopReason = "completed" | "max_iterations" | "cancelled" | "failed";

export interface RalphRunResult {
  stopReason: RalphStopReason;
  docPath: string;
  iterationsCompleted: number;
  totalDurationMs: number;
}

export interface RalphRunOptions {
  agent?: string | string[];
  cwd: string;
  homeDir: string;
  docPath: string;
  maxIterations?: number;
  runtime?: "host" | "docker" | "e2b";
  runtimeImage?: string;
  runtimeTemplate?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
  fs?: RalphFileSystem;
  runAgent?: (input: AgentRunInput) => Promise<AgentRunResult>;
  onIterationStart?: (
    iteration: number,
    maxIterations: number,
    agent: string
  ) => void;
  onIterationComplete?: (
    iteration: number,
    durationMs: number,
    success: boolean
  ) => void;
  signal?: AbortSignal;
}
