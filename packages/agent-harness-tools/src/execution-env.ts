import type { RunnerScope, RuntimeConfig } from "@poe-code/poe-code-config";
import type { RunHandle, RunSpec } from "@poe-code/process-runner";

export type { RuntimeConfig } from "@poe-code/poe-code-config";
export type { RunHandle, RunSpec } from "@poe-code/process-runner";

export type ExecutionEnvType = "host" | "docker" | "e2b";
export type JobStatus = "running" | "exited" | "killed" | "lost";

export interface ExecutionEnvFactory {
  readonly type: ExecutionEnvType;
  open(spec: OpenSpec): Promise<OpenedEnv>;
  attach(envId: string): Promise<OpenedEnv>;
}

export interface OpenSpec {
  cwd: string;
  runtime: RuntimeConfig;
  runner?: RunnerScope;
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

export interface OpenedEnv {
  readonly id: string;
  readonly job: JobHandle | null;
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
  stream(opts?: { sinceByte?: number }): AsyncIterable<LogChunk>;
  wait(): Promise<{ exitCode: number }>;
  kill(signal?: NodeJS.Signals): Promise<void>;
}

const executionEnvFactories = new Map<ExecutionEnvType, ExecutionEnvFactory>();

export function registerExecutionEnvFactory(factory: ExecutionEnvFactory): void {
  executionEnvFactories.set(factory.type, factory);
}

export function selectExecutionEnv(runtime: RuntimeConfig): ExecutionEnvFactory {
  const factory = executionEnvFactories.get(runtime.type);
  if (factory === undefined) {
    throw new Error(
      `No execution environment factory registered for runtime type "${runtime.type}".`
    );
  }
  return factory;
}
