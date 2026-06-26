export interface RalphFileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  mtimeMs: number;
}

export interface RalphFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(
    path: string,
    content: string,
    options?: { flag?: string; mode?: number }
  ): Promise<void>;
  readdir(path: string): Promise<string[]>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  stat(path: string): Promise<RalphFileStat>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

export interface RalphHooks {
  from: string;
  strategy?: "auto" | "symlink" | "transform";
  scope?: "project" | "user" | "merged";
}

export interface AgentRunInput {
  agent: string;
  prompt: string;
  cwd: string;
  model?: string;
  skills?: string[];
  hooks?: RalphHooks;
  runtime?: "host" | "docker" | "e2b";
  runtimeImage?: string;
  runtimeTemplate?: string;
  runtimeConfigCwd?: string;
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
  archive?: boolean;
  runtime?: "host" | "docker" | "e2b";
  runtimeImage?: string;
  runtimeTemplate?: string;
  runtimeConfigCwd?: string;
  detach?: boolean;
  mountPoeCode?: boolean;
  runnerSync?: "both" | "upload" | "none";
  fs?: RalphFileSystem;
  runAgent?: (input: AgentRunInput) => Promise<AgentRunResult>;
  onIterationStart?: (iteration: number, maxIterations: number, agent: string) => void;
  onIterationComplete?: (iteration: number, durationMs: number, success: boolean) => void;
  signal?: AbortSignal;
}
