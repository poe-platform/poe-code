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
}

export interface Runner {
  exec(spec: RunSpec): RunHandle;
  readonly name: string;
}

export interface HostRunnerOptions {
  detached?: boolean;
}

export type Engine = "docker" | "podman";

export interface DockerMount {
  source: string;
  target: string;
  "readonly"?: boolean;
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
