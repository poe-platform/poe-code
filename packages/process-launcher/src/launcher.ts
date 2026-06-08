import path from "node:path";
import * as nodeFs from "node:fs/promises";
import { createLogWriter } from "./logs/log-writer.js";
import { assertPathHasNoSymbolicLinks } from "./path-safety.js";
import { createStateStore } from "./state/state-store.js";
import { createSupervisor } from "./supervisor/supervisor.js";
import type { LauncherFileSystem, ProcessSpec, ProcessState } from "./types.js";

export interface ManagedProcessRecord {
  spec: ProcessSpec | null;
  state: ProcessState | null;
  daemonPid: number | null;
}

export interface StartManagedProcessOptions {
  baseDir: string;
  spec: ProcessSpec;
  fs?: LauncherFileSystem;
  pollIntervalMs?: number;
  startupTimeoutMs?: number;
  spawnDaemon: (id: string) => Promise<number | null>;
  isPidRunning?: (pid: number) => boolean;
  signalProcess?: (pid: number, signal: NodeJS.Signals) => void;
}

export interface StopManagedProcessOptions {
  baseDir: string;
  id: string;
  fs?: LauncherFileSystem;
  force?: boolean;
  pollIntervalMs?: number;
  stopTimeoutMs?: number;
  isPidRunning?: (pid: number) => boolean;
  signalProcess?: (pid: number, signal: NodeJS.Signals) => void;
  stopRuntimeArtifacts?: (input: { record: ManagedProcessRecord; force: boolean }) => Promise<void>;
}

export interface RestartManagedProcessOptions extends Omit<StopManagedProcessOptions, "force"> {
  startupTimeoutMs?: number;
  spawnDaemon: (id: string) => Promise<number | null>;
}

export interface ListManagedProcessesOptions {
  baseDir: string;
  fs?: LauncherFileSystem;
  isPidRunning?: (pid: number) => boolean;
}

export interface ReadManagedLogsOptions {
  baseDir: string;
  id: string;
  fs?: LauncherFileSystem;
  lines?: number;
  stream?: "stdout" | "stderr";
}

export interface FollowManagedLogsOptions extends ReadManagedLogsOptions {
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

export interface RemoveManagedProcessOptions {
  baseDir: string;
  id: string;
  fs?: LauncherFileSystem;
  isPidRunning?: (pid: number) => boolean;
  removeRuntimeArtifacts?: (input: { record: ManagedProcessRecord }) => Promise<void>;
}

export interface RunManagedProcessOptions {
  baseDir: string;
  id: string;
  fs?: LauncherFileSystem;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

interface ManagedProcessMeta {
  daemonPid: number | null;
}

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

export async function startManagedProcess(options: StartManagedProcessOptions): Promise<ManagedProcessRecord> {
  assertOptionalFiniteDuration(options.startupTimeoutMs, "startup timeout");
  const fs = options.fs ?? defaultFs();
  const spec = normalizeSpec(options.spec);
  const existing = await readManagedProcess({
    baseDir: options.baseDir,
    fs,
    id: spec.id,
    isPidRunning: options.isPidRunning
  });

  if (isActiveRecord(existing)) {
    throw new Error(`Managed process "${spec.id}" is already running.`);
  }

  const processDir = resolveProcessDir(options.baseDir, spec.id);
  await assertProcessDirectorySafe(fs, options.baseDir, spec.id);
  await fs.mkdir(processDir, { recursive: true });
  await assertProcessDirectorySafe(fs, options.baseDir, spec.id);
  await writeSpec(fs, options.baseDir, spec);
  await writeState(fs, options.baseDir, createBootstrapState(spec));
  await writeMeta(fs, options.baseDir, spec.id, { daemonPid: null });

  let daemonPid: number | null = null;

  try {
    daemonPid = await options.spawnDaemon(spec.id);
    await writeMeta(fs, options.baseDir, spec.id, { daemonPid });

    const started = await waitForRecord({
      baseDir: options.baseDir,
      fs,
      id: spec.id,
      isPidRunning: options.isPidRunning,
      pollIntervalMs: options.pollIntervalMs,
      timeoutMs: options.startupTimeoutMs,
      ready: (record) => record.state !== null && record.state.status !== "restarting"
    });

    if (started.state?.status !== "running") {
      throw new Error(`Managed process "${spec.id}" failed to start.`);
    }

    return started;
  } catch (error) {
    await cleanupFailedStart({ ...options, daemonPid, fs, id: spec.id });
    throw error;
  }
}

export async function stopManagedProcess(options: StopManagedProcessOptions): Promise<ManagedProcessRecord | null> {
  const fs = options.fs ?? defaultFs();
  const record = await readManagedProcess({
    baseDir: options.baseDir,
    fs,
    id: options.id,
    isPidRunning: options.isPidRunning
  });

  if (record.spec === null && record.state === null && record.daemonPid === null) {
    return null;
  }

  const signal = options.force ? "SIGKILL" : "SIGTERM";
  const signalProcess = options.signalProcess ?? defaultSignalProcess;
  const daemonPid = record.daemonPid;

  if (daemonPid !== null && isProcessRunning(daemonPid, options.isPidRunning)) {
    signalProcess(daemonPid, signal);
  } else if (record.state !== null && isActiveStatus(record.state.status) && record.state.runtime === "host" && record.state.pid !== null) {
    if (isProcessRunning(record.state.pid, options.isPidRunning)) {
      signalProcess(record.state.pid, signal);
    }
  }

  if (record.spec?.docker && options.stopRuntimeArtifacts) {
    await options.stopRuntimeArtifacts({ record, force: Boolean(options.force) });
  }

  const stopped = await waitForStop({
    baseDir: options.baseDir,
    fs,
    id: options.id,
    isPidRunning: options.isPidRunning,
    pollIntervalMs: options.pollIntervalMs,
    timeoutMs: options.stopTimeoutMs
  });

  if (isActiveRecord(stopped)) {
    throw new Error(`Timed out waiting for managed process "${options.id}" to stop.`);
  }

  if (
    record.state !== null &&
    isActiveStatus(record.state.status) &&
    stopped.state !== null &&
    !isActiveStatus(stopped.state.status)
  ) {
    await writeState(fs, options.baseDir, stopped.state);
    await writeMeta(fs, options.baseDir, options.id, { daemonPid: null });
  }

  return stopped;
}

export async function restartManagedProcess(
  options: RestartManagedProcessOptions
): Promise<ManagedProcessRecord> {
  const fs = options.fs ?? defaultFs();
  const record = await readManagedProcess({
    baseDir: options.baseDir,
    fs,
    id: options.id,
    isPidRunning: options.isPidRunning
  });

  if (record.spec === null) {
    throw new Error(`Managed process "${options.id}" was not found.`);
  }

  await stopManagedProcess({
    baseDir: options.baseDir,
    force: false,
    fs,
    id: options.id,
    isPidRunning: options.isPidRunning,
    pollIntervalMs: options.pollIntervalMs,
    signalProcess: options.signalProcess,
    stopRuntimeArtifacts: options.stopRuntimeArtifacts,
    stopTimeoutMs: options.stopTimeoutMs
  });

  return await startManagedProcess({
    baseDir: options.baseDir,
    fs,
    isPidRunning: options.isPidRunning,
    pollIntervalMs: options.pollIntervalMs,
    signalProcess: options.signalProcess,
    spawnDaemon: options.spawnDaemon,
    spec: record.spec,
    startupTimeoutMs: options.startupTimeoutMs
  });
}

async function cleanupFailedStart(options: {
  baseDir: string;
  daemonPid: number | null;
  fs: LauncherFileSystem;
  id: string;
  isPidRunning?: (pid: number) => boolean;
  signalProcess?: (pid: number, signal: NodeJS.Signals) => void;
}): Promise<void> {
  if (options.daemonPid !== null && (options.isPidRunning === undefined || isProcessRunning(options.daemonPid, options.isPidRunning))) {
    (options.signalProcess ?? defaultSignalProcess)(options.daemonPid, "SIGTERM");
  }

  const record = await readManagedProcess(options);
  if (record.state !== null && !isActiveRecord(record)) {
    await writeState(options.fs, options.baseDir, record.state);
    await writeMeta(options.fs, options.baseDir, options.id, { daemonPid: record.daemonPid });
  }
}

export async function listManagedProcesses(
  options: ListManagedProcessesOptions
): Promise<ManagedProcessRecord[]> {
  const fs = options.fs ?? defaultFs();
  const ids = await listIds(fs, options.baseDir);
  const records: ManagedProcessRecord[] = [];

  for (const id of ids) {
    records.push(
      await readManagedProcess({
        baseDir: options.baseDir,
        fs,
        id,
        isPidRunning: options.isPidRunning
      })
    );
  }

  return records.sort((left, right) => {
    const leftId = left.spec?.id ?? left.state?.id ?? "";
    const rightId = right.spec?.id ?? right.state?.id ?? "";
    return leftId.localeCompare(rightId);
  });
}

export async function readManagedLogs(options: ReadManagedLogsOptions): Promise<string[]> {
  const fs = options.fs ?? defaultFs();
  await assertProcessDirectorySafe(fs, options.baseDir, options.id);
  await assertPathNotSymbolicLink(fs, resolveLogDir(options.baseDir, options.id));
  const logWriter = createLogWriter(
    resolveLogDir(options.baseDir, options.id),
    5,
    fs
  );
  return await logWriter.tail(options.stream ?? "stdout", options.lines ?? 50);
}

export async function* followManagedLogs(
  options: FollowManagedLogsOptions
): AsyncIterable<string> {
  const stream = options.stream ?? "stdout";
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
    throw new Error(`Invalid managed log poll interval: ${pollIntervalMs}`);
  }
  let previous = await readFollowedLogs(options, stream);

  while (!options.signal?.aborted) {
    await sleep(pollIntervalMs);
    if (options.signal?.aborted) {
      return;
    }

    const next = await readFollowedLogs(options, stream);

    const delta = hasSamePrefix(previous, next) ? next.slice(previous.length) : next;
    previous = next;

    for (const line of delta) {
      yield line;
    }
  }
}

async function readFollowedLogs(
  options: FollowManagedLogsOptions,
  stream: "stdout" | "stderr"
): Promise<string[]> {
  return await readManagedLogs({
    baseDir: options.baseDir,
    fs: options.fs,
    id: options.id,
    lines: Number.MAX_SAFE_INTEGER,
    stream
  });
}

function hasSamePrefix(previous: string[], next: string[]): boolean {
  if (next.length < previous.length) {
    return false;
  }

  return previous.every((line, index) => next[index] === line);
}

export async function removeManagedProcess(options: RemoveManagedProcessOptions): Promise<void> {
  const fs = options.fs ?? defaultFs();
  const record = await readManagedProcess({
    baseDir: options.baseDir,
    fs,
    id: options.id,
    isPidRunning: options.isPidRunning
  });

  if (isActiveRecord(record)) {
    throw new Error(`Managed process "${options.id}" must be stopped before removal.`);
  }

  const stateStore = createStateStore(options.baseDir, fs);
  await stateStore.remove(options.id);

  if (record.spec !== null && options.removeRuntimeArtifacts) {
    await options.removeRuntimeArtifacts({ record });
  }
}

export async function runManagedProcess(options: RunManagedProcessOptions): Promise<void> {
  if (options.signal?.aborted) {
    return;
  }

  const fs = options.fs ?? defaultFs();
  await assertProcessDirectorySafe(fs, options.baseDir, options.id);
  await assertPathNotSymbolicLink(fs, resolveLogDir(options.baseDir, options.id));
  const spec = await readSpec(fs, options.baseDir, options.id);
  if (spec === null) {
    throw new Error(`Managed process "${options.id}" was not found.`);
  }

  const controller = new AbortController();
  const onExternalAbort = () => {
    controller.abort();
  };
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  const onSignal = () => {
    controller.abort();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    await writeMeta(fs, options.baseDir, options.id, { daemonPid: process.pid });
    const supervisor = createSupervisor({
      fs,
      signal: controller.signal,
      spec,
      stateDir: options.baseDir
    });

    await supervisor.start();

    const pollIntervalMs = options.pollIntervalMs ?? 250;
    while (!controller.signal.aborted) {
      const state = supervisor.getState();
      if (!isActiveStatus(state.status) && state.pid === null) {
        return;
      }
      await sleep(pollIntervalMs);
    }

    await supervisor.stop();
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    options.signal?.removeEventListener("abort", onExternalAbort);
    await writeMeta(fs, options.baseDir, options.id, { daemonPid: null });
  }
}

async function waitForRecord(options: {
  baseDir: string;
  fs: LauncherFileSystem;
  id: string;
  isPidRunning?: (pid: number) => boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
  ready: (record: ManagedProcessRecord) => boolean;
}): Promise<ManagedProcessRecord> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);

  while (Date.now() <= deadline) {
    const record = await readManagedProcess(options);
    if (options.ready(record)) {
      return record;
    }
    await sleep(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for managed process "${options.id}".`);
}

async function waitForStop(options: {
  baseDir: string;
  fs: LauncherFileSystem;
  id: string;
  isPidRunning?: (pid: number) => boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<ManagedProcessRecord> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);

  while (Date.now() <= deadline) {
    const record = await readManagedProcess(options);
    if (!isActiveRecord(record)) {
      return record;
    }
    await sleep(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  }

  return await readManagedProcess(options);
}

async function readManagedProcess(options: {
  baseDir: string;
  fs: LauncherFileSystem;
  id: string;
  isPidRunning?: (pid: number) => boolean;
}): Promise<ManagedProcessRecord> {
  await assertProcessDirectorySafe(options.fs, options.baseDir, options.id);
  const spec = await readSpec(options.fs, options.baseDir, options.id);
  const state = await readState(options.fs, options.baseDir, options.id);
  const meta = await readMeta(options.fs, options.baseDir, options.id);
  return normalizeRecord(
    { daemonPid: meta?.daemonPid ?? null, spec, state },
    options.isPidRunning
  );
}

function normalizeRecord(
  record: ManagedProcessRecord,
  isPidRunningOverride?: (pid: number) => boolean
): ManagedProcessRecord {
  if (record.state === null || !isActiveStatus(record.state.status)) {
    return {
      ...record,
      daemonPid: isProcessRunning(record.daemonPid, isPidRunningOverride) ? record.daemonPid : null
    };
  }

  if (isProcessRunning(record.daemonPid, isPidRunningOverride)) {
    return record;
  }

  if (
    record.state.runtime === "host" &&
    record.state.pid !== null &&
    isProcessRunning(record.state.pid, isPidRunningOverride)
  ) {
    return {
      ...record,
      daemonPid: null
    };
  }

  return {
    ...record,
    daemonPid: null,
    state: createStoppedState(record)
  };
}

function createStoppedState(record: ManagedProcessRecord): ProcessState {
  const spec = record.spec;
  const state = record.state;

  if (state !== null) {
    return {
      ...state,
      pid: null,
      status: state.lastExitCode != null && state.lastExitCode !== 0 ? "crashed" : "stopped",
      lastStoppedAt: state.lastStoppedAt ?? new Date().toISOString()
    };
  }

  if (spec === null) {
    throw new Error("Cannot create a stopped state without spec or state.");
  }

  return {
    args: [...(spec.args ?? [])],
    command: spec.command,
    id: spec.id,
    lastExitCode: null,
    lastStartedAt: null,
    lastStoppedAt: new Date().toISOString(),
    pid: null,
    restartCount: 0,
    runtime: spec.docker ? "docker" : "host",
    status: "stopped"
  };
}

function createBootstrapState(spec: ProcessSpec): ProcessState {
  return {
    args: [...(spec.args ?? [])],
    command: spec.command,
    id: spec.id,
    lastExitCode: null,
    lastStartedAt: null,
    lastStoppedAt: null,
    pid: null,
    restartCount: 0,
    runtime: spec.docker ? "docker" : "host",
    status: "restarting"
  };
}

function normalizeSpec(spec: ProcessSpec): ProcessSpec {
  if (!spec.docker) {
    return {
      ...spec,
      args: [...(spec.args ?? [])],
      env: spec.env ? { ...spec.env } : undefined
    };
  }

  return {
    ...spec,
    args: [...(spec.args ?? [])],
    docker: {
      ...spec.docker,
      containerName: spec.docker.containerName ?? buildContainerName(spec.id),
      mounts: spec.docker.mounts ? [...spec.docker.mounts] : undefined,
      ports: spec.docker.ports ? [...spec.docker.ports] : undefined
    },
    env: spec.env ? { ...spec.env } : undefined
  };
}

function buildContainerName(id: string): string {
  let output = "poe-launch-";

  for (const char of id) {
    const code = char.charCodeAt(0);
    const isAlphaNumeric =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122);

    output += isAlphaNumeric || char === "." || char === "_" || char === "-"
      ? char
      : "-";
  }

  return output;
}

function isActiveRecord(record: ManagedProcessRecord): boolean {
  return record.state !== null && isActiveStatus(record.state.status);
}

function isActiveStatus(status: ProcessState["status"]): boolean {
  return status === "running" || status === "restarting";
}

async function listIds(fs: LauncherFileSystem, baseDir: string): Promise<string[]> {
  try {
    await assertPathNotSymbolicLink(fs, baseDir);
    const entries = await fs.readdir(baseDir);
    const ids: string[] = [];

    for (const entry of entries) {
      const entryPath = path.join(baseDir, entry);
      try {
        await assertPathNotSymbolicLink(fs, entryPath);
        const stat = await fs.stat(entryPath);
        if (!stat.isFile()) {
          ids.push(entry);
        }
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
    }

    return ids.sort();
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

async function readSpec(
  fs: LauncherFileSystem,
  baseDir: string,
  id: string
): Promise<ProcessSpec | null> {
  const spec = await readJsonFile<unknown>(fs, resolveSpecPath(baseDir, id));
  if (spec === null) {
    return null;
  }

  if (!isRecord(spec) || typeof spec.id !== "string" || spec.id !== id) {
    throw new Error(`Invalid managed process specification for "${id}".`);
  }

  return spec as unknown as ProcessSpec;
}

async function writeSpec(fs: LauncherFileSystem, baseDir: string, spec: ProcessSpec): Promise<void> {
  await writeJsonFile(fs, resolveSpecPath(baseDir, spec.id), spec);
}

async function readState(
  fs: LauncherFileSystem,
  baseDir: string,
  id: string
): Promise<ProcessState | null> {
  return await readJsonFile<ProcessState>(fs, resolveStatePath(baseDir, id));
}

async function writeState(fs: LauncherFileSystem, baseDir: string, state: ProcessState): Promise<void> {
  await writeJsonFile(fs, resolveStatePath(baseDir, state.id), state);
}

async function readMeta(
  fs: LauncherFileSystem,
  baseDir: string,
  id: string
): Promise<ManagedProcessMeta | null> {
  const meta = await readJsonFile<unknown>(fs, resolveMetaPath(baseDir, id));
  if (meta === null) {
    return null;
  }

  if (
    !isRecord(meta) ||
    !(meta.daemonPid === null || (
      typeof meta.daemonPid === "number" &&
      Number.isSafeInteger(meta.daemonPid) &&
      meta.daemonPid > 0
    ))
  ) {
    throw new Error(`Invalid managed process metadata for "${id}".`);
  }

  return meta as unknown as ManagedProcessMeta;
}

async function writeMeta(
  fs: LauncherFileSystem,
  baseDir: string,
  id: string,
  meta: ManagedProcessMeta
): Promise<void> {
  await writeJsonFile(fs, resolveMetaPath(baseDir, id), meta);
}

async function readJsonFile<T>(fs: LauncherFileSystem, filePath: string): Promise<T | null> {
  await assertPathNotSymbolicLink(fs, filePath);

  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function writeJsonFile(
  fs: LauncherFileSystem,
  filePath: string,
  value: object
): Promise<void> {
  await assertPathNotSymbolicLink(fs, filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await assertPathNotSymbolicLink(fs, filePath);
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function assertProcessDirectorySafe(
  fs: LauncherFileSystem,
  baseDir: string,
  id: string
): Promise<void> {
  await assertPathNotSymbolicLink(fs, resolveProcessDir(baseDir, id));
}

async function assertPathNotSymbolicLink(fs: LauncherFileSystem, filePath: string): Promise<void> {
  await assertPathHasNoSymbolicLinks(fs, filePath);
}

function assertOptionalFiniteDuration(value: number | undefined, description: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`Invalid managed process ${description}: ${value}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveProcessDir(baseDir: string, id: string): string {
  if (id.length === 0 || id === "." || id === ".." || path.basename(id) !== id) {
    throw new Error(`Invalid managed process id: ${id}`);
  }
  return path.join(baseDir, id);
}

function resolveSpecPath(baseDir: string, id: string): string {
  return path.join(resolveProcessDir(baseDir, id), "spec.json");
}

function resolveStatePath(baseDir: string, id: string): string {
  return path.join(resolveProcessDir(baseDir, id), "state.json");
}

function resolveMetaPath(baseDir: string, id: string): string {
  return path.join(resolveProcessDir(baseDir, id), "meta.json");
}

function resolveLogDir(baseDir: string, id: string): string {
  return path.join(resolveProcessDir(baseDir, id), "logs");
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function defaultFs(): LauncherFileSystem {
  return nodeFs as unknown as LauncherFileSystem;
}

function defaultSignalProcess(pid: number, signal: NodeJS.Signals): void {
  process.kill(pid, signal);
}

function isProcessRunning(
  pid: number | null,
  isPidRunningOverride?: (pid: number) => boolean
): boolean {
  if (pid === null) {
    return false;
  }

  if (isPidRunningOverride) {
    return isPidRunningOverride(pid);
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
