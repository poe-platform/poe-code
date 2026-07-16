import type { Readable, Writable } from "node:stream";

export interface RunHandle {
  readonly pid: number | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  readonly stdin: Writable | null;
  readonly result: Promise<RunResult>;
  kill(signal?: NodeJS.Signals): void;
}

export interface RunResult {
  exitCode: number;
}

export interface RunSpec {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: "pipe" | "inherit" | "ignore";
  stdout?: "pipe" | "inherit";
  stderr?: "pipe" | "inherit";
  tty?: boolean;
  signal?: AbortSignal;
  /** Start in a separate process group so kill() can signal the full group where supported. */
  killProcessGroup?: boolean;
}

export interface Runner {
  exec(spec: RunSpec): RunHandle;
  readonly name: string;
}

export interface HostRunnerOptions {
  detached?: boolean;
}

export type ExecutionEnvType = "host" | "docker";
export type JobStatus = "running" | "exited" | "killed" | "lost";

export interface ExecutionEnvFactory {
  readonly type: ExecutionEnvType;
  readonly supportsDetach?: boolean;
  /** Whether uploadWorkspace/downloadWorkspace move real files, i.e. whether runner.sync means anything. */
  readonly supportsWorkspaceTransfer?: boolean;
  open(spec: OpenSpec): Promise<OpenedEnv>;
  attach(envId: string, context?: AttachedJobContext): Promise<OpenedEnv>;
}

export interface OpenSpec {
  cwd: string;
  runtime: unknown;
  runner?: unknown;
  state?: ExecutionState;
  hostRunner?: Runner;
  env: Record<string, string>;
  uploadIgnoreFiles: string[];
  jobLabel: { tool: string; argv: string[] };
  execution?: {
    wrapForLogTee?: boolean;
    stdin?: RunSpec["stdin"];
    stdout?: RunSpec["stdout"];
    stderr?: RunSpec["stderr"];
    env?: RunSpec["env"];
    tty?: boolean;
    input?: string | Buffer;
    captureOutput?: boolean;
    activityTimeoutMs?: number;
    onStdout?(chunk: string): void;
    onStderr?(chunk: string): void;
  };
  shellSpec?: RunSpec;
}

export interface ExecutionState {
  templates: {
    get(backend: "docker", hash: string): Promise<TemplateEntry | null>;
    put(backend: "docker", entry: TemplateEntry): Promise<void>;
  };
}

export interface TemplateEntry {
  hash: string;
  template_id?: string;
  image?: string;
  runtime_type: string;
  dockerfile_path: string;
  built_at: string;
}

export interface UploadResult {
  files: number;
  bytes: number;
  skipped: { path: string; bytes: number; reason: "max_size" }[];
}

export interface DownloadResult {
  files: number;
  bytes: number;
  conflicts: { path: string; reason: "local_modified" }[];
}

export interface LogChunk {
  byteOffset: number;
  data: string;
}

export interface AttachedJobContext {
  jobId: string;
  tool: string;
  argv: string[];
  cwd: string;
  reattachContext?: Record<string, unknown>;
}

export interface OpenedEnv {
  readonly id: string;
  readonly job: JobHandle | null;
  readonly reattachContext?: Record<string, unknown>;
  uploadWorkspace(): Promise<UploadResult>;
  downloadWorkspace(opts: { conflictPolicy: "refuse" | "overwrite" }): Promise<DownloadResult>;
  exec(spec: RunSpec): RunHandle;
  detach(): Promise<JobHandle>;
  shell(): RunHandle;
  close(): Promise<void>;
}

export interface JobHandle {
  readonly id: string;
  readonly envId: string;
  readonly tool: string;
  readonly argv: string[];
  status(): Promise<JobStatus>;
  stream(opts?: { sinceByte?: number; since?: Date; follow?: boolean }): AsyncIterable<LogChunk>;
  wait(): Promise<{ exitCode: number }>;
  kill(signal?: NodeJS.Signals): Promise<void>;
}

export type Engine = "docker" | "podman";

export interface DockerMount {
  source: string;
  target: string;
  readonly?: boolean;
}

export interface DockerPortMapping {
  host: number;
  container: number;
  protocol?: "tcp" | "udp";
}

export interface DockerRunnerOptions {
  image: string;
  engine?: Engine;
  context?: string;
  mounts?: DockerMount[];
  ports?: DockerPortMapping[];
  network?: string;
  extraArgs?: string[];
  containerName?: string;
}

export interface DockerRunArgs {
  engine: Engine;
  context: string | null;
  image: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  envFilePath?: string;
  mounts: DockerMount[];
  ports: DockerPortMapping[];
  network?: string;
  containerName: string;
  detached: boolean;
  interactive: boolean;
  tty: boolean;
  rm: boolean;
  extraArgs: string[];
}

export interface MockRunBehavior {
  pid?: number;
  exitCode: number;
  exitAfterMs?: number;
  stdout?: string[];
  stderr?: string[];
  stdoutInterval?: number;
}
