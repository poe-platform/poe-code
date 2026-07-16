import type { DockerRunnerOptions, Runner } from "@poe-code/process-runner";

export interface LauncherFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readFileBytes?(path: string, start: number): Promise<Uint8Array>;
  writeFile(
    path: string,
    content: string,
    options?: { encoding?: BufferEncoding; flag?: string; mode?: number }
  ): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  stat(path: string): Promise<{ isFile(): boolean; mtimeMs: number; size?: number; dev?: number; ino?: number }>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  readdir(path: string): Promise<string[]>;
  appendFile(path: string, content: string): Promise<void>;
}

export type ReadyCheck =
  | { kind: "log-pattern"; pattern: string }
  | { kind: "tcp"; port: number; host?: string; timeoutMs?: number };

export type RestartPolicy = "never" | "on-failure" | "always";

export interface ProcessSpec {
  id: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  restart: RestartPolicy;
  maxRestarts?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  readyCheck?: ReadyCheck;
  logRetainCount?: number;
  docker?: DockerRunnerOptions;
}

export type ProcessStatus = "running" | "stopped" | "crashed" | "restarting";

export interface ProcessState {
  id: string;
  pid: number | null;
  status: ProcessStatus;
  runtime: "host" | "docker";
  restartCount: number;
  lastExitCode: number | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  command: string;
  args: string[];
}

export interface SupervisorOptions {
  spec: ProcessSpec;
  stateDir: string;
  runner?: Runner;
  fs?: LauncherFileSystem;
  signal?: AbortSignal;
  startSettleMs?: number;
  onStatusChange?: (state: ProcessState) => void;
  onLog?: (line: string, stream: "stdout" | "stderr") => void;
  onError?: (error: unknown) => void;
}

export interface Supervisor {
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  getState(): ProcessState;
}

export interface StateStore {
  read(id: string): Promise<ProcessState | null>;
  write(id: string, state: ProcessState): Promise<void>;
  list(): Promise<ProcessState[]>;
  remove(id: string): Promise<void>;
}

export interface LogWriter {
  write(line: string, stream: "stdout" | "stderr"): Promise<void>;
  rotate(): Promise<void>;
  tail(stream: "stdout" | "stderr", lines?: number): Promise<string[]>;
  close(): void;
}
