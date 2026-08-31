import { spawn as spawnChildProcess } from "node:child_process";
import * as nodeFs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createDockerRunner,
  createHostRunner,
  type RunHandle,
  type RunSpec,
  type Runner
} from "@poe-code/process-runner";
import { resolveWorkspace, type ExecResult } from "@poe-code/workspace-resolver";
import { waitForReady } from "../health/health-check.js";
import { createLogWriter } from "../logs/log-writer.js";
import { assertValidManagedProcessId } from "../process-id.js";
import { createStateStore } from "../state/state-store.js";
import type { ProcessState, ReadyCheck, Supervisor, SupervisorOptions } from "../types.js";

type LogListener = (line: string, stream: "stdout" | "stderr") => void;
type SubscribableLog = LogListener & {
  subscribe(listener: LogListener): () => void;
  publishPartial(line: string, stream: "stdout" | "stderr"): void;
};

const DEFAULT_START_SETTLE_MS = 250;
const WORKSPACE_COMMAND_TIMEOUT_MS = 10 * 60_000;
const WORKSPACE_COMMAND_KILL_GRACE_MS = 1_000;

export function createSupervisor(options: SupervisorOptions): Supervisor {
  const { spec } = options;
  const readyChecker =
    (options as SupervisorOptions & { readyChecker?: typeof waitForReady }).readyChecker ??
    waitForReady;
  assertValidManagedProcessId(spec.id);
  assertValidRestartConfig(spec);
  const runner = resolveRunner(options);
  const stateStore = createStateStore(options.stateDir, options.fs);
  const logWriter = createLogWriter(
    path.join(options.stateDir, spec.id, "logs"),
    spec.logRetainCount ?? 5,
    options.fs
  );
  const logSource = createLogSource(options.onLog);

  let state = createInitialState(spec, runner);
  let handle: RunHandle | null = null;
  let runId = 0;
  let startPromise: Promise<void> | null = null;
  let pendingRestart: symbol | null = null;
  let activeReadyController: AbortController | null = null;
  let activeWorkspaceController: AbortController | null = null;
  let stableTimer: NodeJS.Timeout | null = null;
  let stopRequested = false;
  let workspacePromise: Promise<{ cwd?: string; cleanup?: () => Promise<void> }> | null = null;
  let workspaceCleanupPromise: Promise<void> | null = null;

  const onAbort = () => {
    void stop().catch(reportError);
  };

  options.signal?.addEventListener("abort", onAbort, { once: true });

  async function start(): Promise<void> {
    if (options.signal?.aborted) {
      return;
    }

    if (startPromise !== null) {
      await startPromise;
      return;
    }

    if (handle !== null || pendingRestart !== null) {
      return;
    }

    stopRequested = false;
    startPromise = launch(false);

    try {
      await startPromise;
    } finally {
      startPromise = null;
    }
  }

  async function stop(): Promise<void> {
    stopRequested = true;
    pendingRestart = null;
    activeReadyController?.abort();
    activeReadyController = null;
    activeWorkspaceController?.abort(new Error("Workspace preparation stopped."));

    const activeHandle = handle;

    if (activeHandle !== null) {
      await terminateHandle(activeHandle);
    }

    clearStableTimer();
    handle = null;
    state.pid = null;
    state.lastStoppedAt = new Date().toISOString();
    await transitionTo("stopped");
    await cleanupWorkspace();
  }

  async function restart(): Promise<void> {
    await stop();
    await start();
  }

  function getState(): ProcessState {
    return {
      ...state,
      args: [...state.args]
    };
  }

  async function launch(isRestart: boolean): Promise<void> {
    const nextRunId = runId + 1;
    runId = nextRunId;
    const workspace = await ensureWorkspace();
    if (stopRequested || options.signal?.aborted) {
      await cleanupWorkspace();
      return;
    }

    let nextHandle: RunHandle;
    try {
      nextHandle = runner.exec(createRunSpec(spec, runner, workspace.cwd));
    } catch (error) {
      await cleanupWorkspace();
      throw error;
    }
    handle = nextHandle;
    state.pid = nextHandle.pid;
    state.lastExitCode = null;
    state.lastStartedAt = new Date().toISOString();

    if (spec.readyCheck !== undefined) {
      activeReadyController = new AbortController();
    }

    const stdoutPump = pipeOutput(nextHandle.stdout, "stdout", logWriter.write, logSource, reportError);
    const stderrPump = pipeOutput(nextHandle.stderr, "stderr", logWriter.write, logSource, reportError);
    const outputSettled = Promise.all([stdoutPump, stderrPump]).then(() => undefined);
    const readiness = spec.readyCheck === undefined ? null : readyChecker(resolveReadyCheck(spec.readyCheck, spec), {
      onLog: logSource,
      signal: activeReadyController?.signal
    });

    scheduleStableReset(nextRunId, nextHandle);
    void monitorExit(nextHandle, nextRunId, outputSettled).catch(reportError);

    if (readiness !== null) {
      await transitionTo("restarting", true);
      const ready = await readiness;
      activeReadyController = null;

      if (!ready) {
        if (runId === nextRunId && handle === nextHandle) {
          await terminateHandle(nextHandle);
        }

        if (!isRestart) {
          throw new Error(`Managed process "${spec.id}" failed readiness during startup.`);
        }

        return;
      }

      if (runId !== nextRunId || handle !== nextHandle) {
        return;
      }
    }

    if (isRestart || spec.readyCheck !== undefined) {
      await transitionTo("running");
      return;
    }

    const settleMs = options.startSettleMs ?? DEFAULT_START_SETTLE_MS;
    if (!(await hasSurvivedSettleWindow(nextHandle, settleMs))) {
      return;
    }

    if (runId !== nextRunId || handle !== nextHandle || stopRequested) {
      return;
    }

    await transitionTo("running");
  }

  async function monitorExit(
    finishedHandle: RunHandle,
    finishedRunId: number,
    outputSettled: Promise<void>
  ): Promise<void> {
    const result = await finishedHandle.result;
    try {
      await outputSettled;
    } catch (error) {
      reportError(error);
    }

    if (runId !== finishedRunId) {
      return;
    }

    clearStableTimer();
    activeReadyController?.abort();
    activeReadyController = null;
    handle = null;
    state.pid = null;
    state.lastExitCode = result.exitCode;
    state.lastStoppedAt = new Date().toISOString();

    if (stopRequested || options.signal?.aborted) {
      await transitionTo("stopped", true);
      await cleanupWorkspace();
      return;
    }

    if (!shouldRestart(result.exitCode, spec.restart)) {
      await transitionTo("stopped", true);
      await cleanupWorkspace();
      return;
    }

    const maxRestarts = spec.maxRestarts ?? 5;

    if (maxRestarts > 0 && state.restartCount >= maxRestarts) {
      await transitionTo("crashed");
      await cleanupWorkspace();
      return;
    }

    const backoffMs = getBackoffDelay(
      state.restartCount,
      spec.backoffMs ?? 1_000,
      spec.maxBackoffMs ?? 30_000
    );

    state.restartCount += 1;
    try {
      await logWriter.rotate();
    } catch (error) {
      await transitionTo("crashed");
      reportError(error);
      await cleanupWorkspace();
      return;
    }
    await transitionTo("restarting");

    const restartToken = Symbol("restart");
    pendingRestart = restartToken;
    await delay(backoffMs);

    if (pendingRestart !== restartToken || stopRequested || options.signal?.aborted) {
      return;
    }

    pendingRestart = null;
    try {
      await launch(true);
    } catch (error) {
      await transitionTo("crashed");
      reportError(error);
      await cleanupWorkspace();
    }
  }

  async function transitionTo(status: ProcessState["status"], force = false): Promise<void> {
    if (!force && state.status === status) {
      return;
    }

    state = {
      ...state,
      args: [...state.args],
      status
    };
    await stateStore.write(spec.id, state);
    options.onStatusChange?.(getState());
  }

  function scheduleStableReset(activeRunId: number, activeHandle: RunHandle): void {
    clearStableTimer();
    stableTimer = setTimeout(() => {
      if (runId !== activeRunId || handle !== activeHandle || state.restartCount === 0) {
        return;
      }

      const previousRestartCount = state.restartCount;
      const resetState = { ...getState(), restartCount: 0 };
      void stateStore.write(spec.id, resetState).then(() => {
        state.restartCount = 0;
      }, error => {
        state.restartCount = previousRestartCount;
        reportError(error);
      });
    }, 60_000);
  }

  function clearStableTimer(): void {
    if (stableTimer !== null) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }
  }

  async function ensureWorkspace(): Promise<{ cwd?: string; cleanup?: () => Promise<void> }> {
    if (workspacePromise !== null) {
      return await workspacePromise;
    }

    const controller = new AbortController();
    activeWorkspaceController = controller;
    workspacePromise = resolveProcessWorkspace(spec.cwd, options.stateDir, () =>
      activeWorkspaceController === controller ? controller.signal : undefined
    ).finally(() => {
      if (activeWorkspaceController === controller) {
        activeWorkspaceController = null;
      }
    });

    try {
      return await workspacePromise;
    } catch (error) {
      workspacePromise = null;
      throw error;
    }
  }

  async function cleanupWorkspace(): Promise<void> {
    if (workspacePromise === null) {
      return;
    }

    let workspace: { cwd?: string; cleanup?: () => Promise<void> };
    try {
      workspace = await workspacePromise;
    } catch (error) {
      workspacePromise = null;
      if (stopRequested || options.signal?.aborted) {
        return;
      }
      throw error;
    }
    if (!workspace.cleanup) {
      return;
    }

    if (workspaceCleanupPromise !== null) {
      await workspaceCleanupPromise;
      return;
    }

    workspaceCleanupPromise = workspace.cleanup().finally(() => {
      workspaceCleanupPromise = null;
      workspacePromise = null;
    });

    await workspaceCleanupPromise;
  }

  function reportError(error: unknown): void {
    options.onError?.(error);
  }

  return {
    start,
    stop,
    restart,
    getState
  };
}

function resolveRunner(options: SupervisorOptions): Runner {
  if (options.runner !== undefined) {
    return options.runner;
  }

  if (options.spec.docker !== undefined) {
    return createDockerRunner(options.spec.docker);
  }

  return createHostRunner();
}

function createInitialState(spec: SupervisorOptions["spec"], runner: Runner): ProcessState {
  return {
    id: spec.id,
    pid: null,
    status: "stopped",
    runtime: spec.docker !== undefined || runner.name === "docker" ? "docker" : "host",
    restartCount: 0,
    lastExitCode: null,
    lastStartedAt: null,
    lastStoppedAt: null,
    command: spec.command,
    args: [...(spec.args ?? [])]
  };
}

function createRunSpec(spec: SupervisorOptions["spec"], runner: Runner, cwdOverride?: string): RunSpec {
  let env = spec.env;
  if (runner.name === "host" && env !== undefined) {
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
    );
    env = { ...inherited, ...env };
  }

  return {
    command: spec.command,
    args: spec.args,
    cwd: cwdOverride ?? spec.cwd,
    env,
    stderr: "pipe",
    stdout: "pipe"
  };
}

async function hasSurvivedSettleWindow(activeHandle: RunHandle, settleMs: number): Promise<boolean> {
  if (settleMs <= 0) {
    return true;
  }

  let timer: NodeJS.Timeout | undefined;
  const survived = new Promise<boolean>(resolve => {
    timer = setTimeout(() => resolve(true), settleMs);
  });

  try {
    return await Promise.race([activeHandle.result.then(() => false, () => false), survived]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function shouldRestart(exitCode: number, policy: SupervisorOptions["spec"]["restart"]): boolean {
  if (policy === "always") {
    return true;
  }

  if (policy === "on-failure") {
    return exitCode !== 0;
  }

  return false;
}

function getBackoffDelay(restartCount: number, backoffMs: number, maxBackoffMs: number): number {
  return Math.min(backoffMs * 2 ** restartCount, maxBackoffMs);
}

function assertValidRestartConfig(spec: SupervisorOptions["spec"]): void {
  if (spec.maxRestarts !== undefined && (!Number.isSafeInteger(spec.maxRestarts) || spec.maxRestarts < 0)) {
    throw new Error(`Invalid maximum managed process restarts: ${spec.maxRestarts}`);
  }

  for (const [description, value] of [["backoff", spec.backoffMs], ["maximum backoff", spec.maxBackoffMs]] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`Invalid managed process ${description}: ${value}`);
    }
  }
}

function delay(durationMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, durationMs);
  });
}

async function terminateHandle(activeHandle: RunHandle): Promise<void> {
  activeHandle.kill("SIGTERM");

  const exited = await waitForExit(activeHandle, 5_000);
  if (!exited) {
    activeHandle.kill("SIGKILL");
    await activeHandle.result;
  }
}

function waitForExit(activeHandle: RunHandle, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    let finished = false;

    const timeout = setTimeout(() => {
      finish(false);
    }, timeoutMs);

    void activeHandle.result.then(() => {
      finish(true);
    });

    function finish(result: boolean): void {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      resolve(result);
    }
  });
}

function createLogSource(onLog: SupervisorOptions["onLog"]): SubscribableLog {
  const listeners = new Set<LogListener>();

  const notifySubscribers = (line: string, stream: "stdout" | "stderr") => {
    for (const listener of listeners) {
      listener(line, stream);
    }
  };

  const log = ((line: string, stream: "stdout" | "stderr") => {
    onLog?.(line, stream);
    notifySubscribers(line, stream);
  }) as SubscribableLog;

  log.subscribe = listener => {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  };
  log.publishPartial = notifySubscribers;

  return log;
}

function pipeOutput(
  stream: NodeJS.ReadableStream | null,
  output: "stdout" | "stderr",
  write: (line: string, stream: "stdout" | "stderr") => Promise<void>,
  logSource: SubscribableLog,
  reportError: (error: unknown) => void
): Promise<void> {
  if (stream === null) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let remainder = "";
    let writes = Promise.resolve();

    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      remainder += chunk;

      while (true) {
        const lineBreak = remainder.indexOf("\n");

        if (lineBreak === -1) {
          break;
        }

        const rawLine = remainder.slice(0, lineBreak);
        remainder = remainder.slice(lineBreak + 1);
        writes = writes.then(async () => {
          const line = normalizeLogLine(rawLine);
          logSource(line, output);
          await write(line, output);
        }).catch(reportError);
      }

      if (remainder.length > 0) {
        logSource.publishPartial(normalizeLogLine(remainder), output);
      }
    });
    stream.once("end", () => {
      if (remainder.length > 0) {
        const finalLine = normalizeLogLine(remainder);
        writes = writes.then(async () => {
          logSource(finalLine, output);
          await write(finalLine, output);
        }).catch(reportError);
      }

      void writes.then(() => {
        resolve();
      }, reject);
    });
    stream.once("error", reject);
  });
}

function normalizeLogLine(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

async function resolveProcessWorkspace(
  cwd: string | undefined,
  stateDir: string,
  commandSignal: () => AbortSignal | undefined = () => undefined
): Promise<{ cwd?: string; cleanup?: () => Promise<void> }> {
  if (!cwd) {
    return {};
  }

  const resolved = await resolveWorkspace(cwd, {
    baseDir: process.cwd(),
    homeDir: resolveWorkspaceHomeDir(stateDir),
    mode: "edit",
    exec: async (command, args, options) =>
      execWorkspaceCommand(command, args, options?.cwd, commandSignal()),
    fs: {
      mkdir: async (target, options) => {
        await nodeFs.mkdir(target, options);
      },
      stat: async (target) => await nodeFs.stat(target),
      lstat: async (target) => await nodeFs.lstat(target),
      rm: async (target, options) => {
        await nodeFs.rm(target, options);
      }
    }
  });

  return {
    cwd: resolved.cwd,
    cleanup: resolved.cleanup
  };
}

function resolveWorkspaceHomeDir(stateDir: string): string {
  if (
    path.basename(stateDir) === "launch" &&
    path.basename(path.dirname(stateDir)) === ".poe-code"
  ) {
    return path.dirname(path.dirname(stateDir));
  }

  return os.homedir();
}

function execWorkspaceCommand(
  command: string,
  args: string[],
  cwd?: string,
  signal?: AbortSignal
): Promise<ExecResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({
        stdout: "",
        stderr: "Workspace command aborted.",
        exitCode: 130
      });
      return;
    }

    const child = spawnChildProcess(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let terminationMessage: string | undefined;
    let timeout: NodeJS.Timeout | undefined = setTimeout(() => {
      terminate("timeout");
    }, WORKSPACE_COMMAND_TIMEOUT_MS);
    let escalationTimeout: NodeJS.Timeout | undefined;

    const cleanup = (): void => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      if (escalationTimeout !== undefined) {
        clearTimeout(escalationTimeout);
        escalationTimeout = undefined;
      }
      signal?.removeEventListener("abort", abortCommand);
    };

    const finish = (result: ExecResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const terminate = (reason: "timeout" | "abort"): void => {
      if (settled || timedOut || aborted) {
        return;
      }

      timedOut = reason === "timeout";
      aborted = reason === "abort";
      terminationMessage =
        reason === "timeout"
          ? `Workspace command timed out after ${WORKSPACE_COMMAND_TIMEOUT_MS} ms.`
          : "Workspace command aborted.";
      child.kill("SIGTERM");
      escalationTimeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, WORKSPACE_COMMAND_KILL_GRACE_MS);
    };

    function abortCommand(): void {
      terminate("abort");
    }

    signal?.addEventListener("abort", abortCommand, { once: true });

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });

    child.once("error", (error: NodeJS.ErrnoException) => {
      const exitCode =
        getOwnNumericErrorProperty(error, "code") ??
        getOwnNumericErrorProperty(error, "errno") ??
        127;
      finish({
        stdout,
        stderr: appendWorkspaceCommandMessage(stderr, error.message),
        exitCode
      });
    });

    child.once("close", (code, closeSignal) => {
      const exitCode = timedOut ? 124 : aborted ? 130 : code ?? signalExitCode(closeSignal);
      finish({
        stdout,
        stderr: appendWorkspaceCommandMessage(stderr, terminationMessage),
        exitCode
      });
    });
  });
}

function getOwnNumericErrorProperty(
  error: NodeJS.ErrnoException,
  property: "code" | "errno"
): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(error, property)) {
    return undefined;
  }

  const value = error[property];
  return typeof value === "number" ? value : undefined;
}

function appendWorkspaceCommandMessage(stderr: string, message: string | undefined): string {
  if (message === undefined) {
    return stderr;
  }
  return stderr.length === 0 ? message : `${stderr}${message}`;
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  const signalNumber = signal ? os.constants.signals[signal] : undefined;
  return typeof signalNumber === "number" ? 128 + signalNumber : 1;
}

function resolveReadyCheck(check: ReadyCheck, spec: SupervisorOptions["spec"]): ReadyCheck {
  if (check.kind !== "tcp" || spec.docker === undefined) {
    return check;
  }

  const portMapping = spec.docker.ports?.find(mapping => {
    if (mapping.container !== check.port) {
      return false;
    }

    return mapping.protocol === undefined || mapping.protocol === "tcp";
  });

  if (portMapping === undefined) {
    return check;
  }

  return {
    ...check,
    port: portMapping.host
  };
}
