import {native} from "./native.js";
import type { RunnerScope, RuntimeConfig } from "./config/core.js";
import type { RunHandle, Runner, RunSpec } from "./runner-types.js";
import type { StateManager } from "./config/core.js";

export type { RuntimeConfig } from "./config/core.js";
export type { RunHandle, RunSpec } from "./runner-types.js";

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
  runtimeCwd?: string;
  runtime: RuntimeConfig;
  runner?: RunnerScope;
  state?: StateManager;
  hostRunner?: Runner;
  env: Record<string, string>;
  uploadIgnoreFiles: string[];
  jobLabel: { tool: string; argv: string[]; displayArgv?: string[] };
  execution?: {
    wrapForLogTee?: boolean;
    stdin?: RunSpec["stdin"];
    stdout?: RunSpec["stdout"];
    stderr?: RunSpec["stderr"];
    env?: RunSpec["env"];
    tty?: boolean;
    input?: string | Buffer;
    captureOutput?: boolean;
    /** Keep stdout callbacks and draining, without retaining its full text when false. */
    captureStdout?: boolean;
    activityTimeoutMs?: number;
    activityTimeoutSource?: "all" | "stdout";
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
  status(opts?: { signal?: AbortSignal }): Promise<JobStatus>;
  stream(opts?: { sinceByte?: number; since?: Date; follow?: boolean; signal?: AbortSignal }): AsyncIterable<LogChunk>;
  wait(): Promise<{ exitCode: number }>;
  kill(signal?: NodeJS.Signals): Promise<void>;
}

const registry=new native.NativeHarnessFactories();
const executionEnvFactories:ExecutionEnvFactory[]=[];
// Native slots never move or disappear; cache their IDs across replacements.
const factorySlots=new Map<ExecutionEnvType,number>();

export function registerExecutionEnvFactory(factory: ExecutionEnvFactory): void {
  const type=factory.type;
  let slot=factorySlots.get(type);
  if(slot===undefined){slot=registry.register(type);factorySlots.set(type,slot);}
  executionEnvFactories[slot]=factory;
}

export function selectExecutionEnv(runtime: RuntimeConfig): ExecutionEnvFactory {
  return selectExecutionEnvFactory(runtime.type);
}

export function selectExecutionEnvFactory(type: ExecutionEnvType): ExecutionEnvFactory {
  const slot=factorySlots.get(type);
  if (slot === undefined) {
    throw new Error(
      `No execution environment factory registered for runtime type "${type}".`
    );
  }
  return executionEnvFactories[slot];
}
