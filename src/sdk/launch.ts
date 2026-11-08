import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseLocator } from "@poe-code/workspace-resolver";
import {
  followManagedLogs,
  listManagedProcesses,
  readManagedLogs,
  removeManagedProcess,
  restartManagedProcess,
  runManagedProcess,
  startManagedProcess,
  stopManagedProcess,
  type FollowManagedLogsOptions,
  type ManagedProcessRecord,
  type ProcessSpec
} from "@poe-code/process-launcher";
import { createHostRunner, detectEngine, type Engine } from "@poe-code/process-runner";
import { hasOwnErrorCode } from "../utils/error-codes.js";
import { getCurrentExecutionContext } from "../utils/execution-context.js";

export type { ManagedProcessRecord, ProcessSpec } from "@poe-code/process-launcher";

export interface LaunchBaseOptions {
  cwd?: string;
  homeDir?: string;
  variables?: Record<string, string | undefined>;
}

export interface StartLaunchOptions extends LaunchBaseOptions {
  spec: ProcessSpec;
}

export interface StopLaunchOptions extends LaunchBaseOptions {
  id: string;
  force?: boolean;
}

export interface RestartLaunchOptions extends LaunchBaseOptions {
  id: string;
}

export type ListLaunchesOptions = LaunchBaseOptions;

export interface ReadLaunchLogsOptions extends LaunchBaseOptions {
  id: string;
  lines?: number;
  stream?: "stdout" | "stderr";
}

export interface FollowLaunchLogsSdkOptions extends LaunchBaseOptions {
  id: string;
  lines?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  stream?: "stdout" | "stderr";
}

export interface RemoveLaunchOptions extends LaunchBaseOptions {
  id: string;
}

export interface RunLaunchDaemonOptions extends LaunchBaseOptions {
  id: string;
  signal?: AbortSignal;
}

export async function startLaunch(options: StartLaunchOptions): Promise<ManagedProcessRecord> {
  const homeDir = resolveHomeDir(options.homeDir);
  const cwd = options.cwd ?? process.cwd();
  const variables = options.variables ?? process.env;
  const executionContext = getCurrentExecutionContext(import.meta.url);
  const runner = createHostRunner({ detached: true });
  const spec = normalizeLaunchSpec(options.spec, cwd);

  return await startManagedProcess({
    baseDir: resolveLaunchBaseDir(homeDir),
    spec,
    spawnDaemon: async (id) => {
      const handle = runner.exec({
        args: [...executionContext.command.args, "launch", "__run", id],
        command: executionContext.command.command,
        cwd,
        env: objectToEnv(variables),
        stderr: "inherit",
        stdin: "ignore",
        stdout: "inherit"
      });
      return handle.pid;
    }
  });
}

export async function stopLaunch(options: StopLaunchOptions): Promise<ManagedProcessRecord | null> {
  const homeDir = resolveHomeDir(options.homeDir);
  return await stopManagedProcess({
    baseDir: resolveLaunchBaseDir(homeDir),
    force: options.force,
    id: options.id,
    signalProcess: sendSignalToManagedProcess,
    stopRuntimeArtifacts: async ({ record, force }) => {
      await stopDockerArtifacts(record, force);
    }
  });
}

export async function restartLaunch(options: RestartLaunchOptions): Promise<ManagedProcessRecord> {
  const homeDir = resolveHomeDir(options.homeDir);
  const cwd = options.cwd ?? process.cwd();
  const variables = options.variables ?? process.env;
  const executionContext = getCurrentExecutionContext(import.meta.url);
  const runner = createHostRunner({ detached: true });

  return await restartManagedProcess({
    baseDir: resolveLaunchBaseDir(homeDir),
    id: options.id,
    signalProcess: sendSignalToManagedProcess,
    spawnDaemon: async (id) => {
      const handle = runner.exec({
        args: [...executionContext.command.args, "launch", "__run", id],
        command: executionContext.command.command,
        cwd,
        env: objectToEnv(variables),
        stderr: "inherit",
        stdin: "ignore",
        stdout: "inherit"
      });
      return handle.pid;
    },
    stopRuntimeArtifacts: async ({ record, force }) => {
      await stopDockerArtifacts(record, force);
    }
  });
}

export async function listLaunches(options: ListLaunchesOptions = {}): Promise<ManagedProcessRecord[]> {
  return await listManagedProcesses({
    baseDir: resolveLaunchBaseDir(resolveHomeDir(options.homeDir))
  });
}

export async function readLaunchLogs(options: ReadLaunchLogsOptions): Promise<string[]> {
  return await readManagedLogs({
    baseDir: resolveLaunchBaseDir(resolveHomeDir(options.homeDir)),
    id: options.id,
    lines: options.lines,
    stream: options.stream
  });
}

export function followLaunchLogs(options: FollowLaunchLogsSdkOptions): AsyncIterable<string> {
  const forwarded: FollowManagedLogsOptions = {
    baseDir: resolveLaunchBaseDir(resolveHomeDir(options.homeDir)),
    id: options.id,
    lines: options.lines,
    pollIntervalMs: options.pollIntervalMs,
    signal: options.signal,
    stream: options.stream
  };
  return followManagedLogs(forwarded);
}

export async function removeLaunch(options: RemoveLaunchOptions): Promise<void> {
  await removeManagedProcess({
    baseDir: resolveLaunchBaseDir(resolveHomeDir(options.homeDir)),
    id: options.id,
    removeRuntimeArtifacts: async ({ record }) => {
      await removeDockerArtifacts(record);
    }
  });
}

export async function runLaunchDaemon(options: RunLaunchDaemonOptions): Promise<void> {
  await runManagedProcess({
    baseDir: resolveLaunchBaseDir(resolveHomeDir(options.homeDir)),
    id: options.id,
    signal: options.signal
  });
}

function resolveLaunchBaseDir(homeDir: string): string {
  return path.join(homeDir, ".poe-code", "launch");
}

function resolveHomeDir(homeDir: string | undefined): string {
  if (homeDir) {
    return homeDir;
  }
  return process.env.HOME ?? process.cwd();
}

function normalizeLaunchSpec(spec: ProcessSpec, baseDir: string): ProcessSpec {
  if (!spec.cwd) {
    return spec;
  }

  const locator = parseLocator(spec.cwd);
  if (locator.scheme !== "local") {
    return spec;
  }

  const cwd = path.isAbsolute(locator.path) ? locator.path : path.resolve(baseDir, locator.path);
  return {
    ...spec,
    cwd
  };
}

function sendSignalToManagedProcess(pid: number, signal: NodeJS.Signals): void {
  if (process.platform === "win32") {
    process.kill(pid, signal);
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!isMissingProcessGroupError(error)) {
      throw error;
    }

    process.kill(pid, signal);
  }
}

function isMissingProcessGroupError(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "ESRCH");
}

function objectToEnv(
  variables: Record<string, string | undefined>
): Record<string, string> {
  const env: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(variables)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

async function stopDockerArtifacts(record: ManagedProcessRecord, force: boolean): Promise<void> {
  if (!record.spec?.docker?.containerName) {
    return;
  }

  const engine = resolveEngine(record.spec.docker.engine);
  const command = force ? "kill" : "stop";
  spawnSync(engine, [command, record.spec.docker.containerName], { stdio: "ignore" });
}

async function removeDockerArtifacts(record: ManagedProcessRecord): Promise<void> {
  if (!record.spec?.docker?.containerName) {
    return;
  }

  const engine = resolveEngine(record.spec.docker.engine);
  spawnSync(engine, ["rm", "-f", record.spec.docker.containerName], { stdio: "ignore" });
}

function resolveEngine(engine: Engine | undefined): Engine {
  if (engine) {
    return engine;
  }
  return detectEngine();
}
