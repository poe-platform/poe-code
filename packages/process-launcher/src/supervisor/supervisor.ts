import path from "node:path";
import {
  createDockerRunner,
  createHostRunner,
  type RunHandle,
  type RunSpec,
  type Runner
} from "@poe-code/process-runner";
import { waitForReady } from "../health/health-check.js";
import { createLogWriter } from "../logs/log-writer.js";
import { createStateStore } from "../state/state-store.js";
import type { ProcessState, ReadyCheck, Supervisor, SupervisorOptions } from "../types.js";

type LogListener = (line: string, stream: "stdout" | "stderr") => void;
type SubscribableLog = LogListener & {
  subscribe(listener: LogListener): () => void;
};

export function createSupervisor(options: SupervisorOptions): Supervisor {
  const { spec } = options;
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
  let stableTimer: NodeJS.Timeout | null = null;
  let stopRequested = false;

  const onAbort = () => {
    void stop();
  };

  options.signal?.addEventListener("abort", onAbort, { once: true });

  async function start(): Promise<void> {
    if (handle !== null || pendingRestart !== null) {
      return;
    }

    if (startPromise !== null) {
      await startPromise;
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

    const activeHandle = handle;

    if (activeHandle !== null) {
      activeHandle.kill("SIGTERM");

      const exited = await waitForExit(activeHandle, 5_000);
      if (!exited) {
        activeHandle.kill("SIGKILL");
        await activeHandle.result;
      }
    }

    clearStableTimer();
    handle = null;
    state.pid = null;
    state.lastStoppedAt = new Date().toISOString();
    await transitionTo("stopped");
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
    const nextHandle = runner.exec(createRunSpec(spec));
    handle = nextHandle;
    state.pid = nextHandle.pid;
    state.lastExitCode = null;
    state.lastStartedAt = new Date().toISOString();

    const stdoutPump = pipeOutput(nextHandle.stdout, "stdout", logWriter.write, logSource);
    const stderrPump = pipeOutput(nextHandle.stderr, "stderr", logWriter.write, logSource);
    const outputSettled = Promise.all([stdoutPump, stderrPump]).then(() => undefined);

    scheduleStableReset(nextRunId, nextHandle);
    void monitorExit(nextHandle, nextRunId, outputSettled);

    if (spec.readyCheck !== undefined) {
      await transitionTo("restarting");
      activeReadyController = new AbortController();
      const ready = await waitForReady(resolveReadyCheck(spec.readyCheck, spec), {
        onLog: logSource,
        signal: activeReadyController.signal
      });
      activeReadyController = null;

      if (runId !== nextRunId || handle !== nextHandle) {
        return;
      }

      if (!ready) {
        nextHandle.kill("SIGTERM");
        return;
      }
    }

    if (isRestart || spec.readyCheck !== undefined) {
      await transitionTo("running");
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
    await outputSettled;

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
      await transitionTo("stopped");
      return;
    }

    if (!shouldRestart(result.exitCode, spec.restart)) {
      await transitionTo("stopped");
      return;
    }

    const maxRestarts = spec.maxRestarts ?? 5;

    if (maxRestarts > 0 && state.restartCount >= maxRestarts) {
      await transitionTo("crashed");
      return;
    }

    const backoffMs = getBackoffDelay(
      state.restartCount,
      spec.backoffMs ?? 1_000,
      spec.maxBackoffMs ?? 30_000
    );

    state.restartCount += 1;
    await logWriter.rotate();
    await transitionTo("restarting");

    const restartToken = Symbol("restart");
    pendingRestart = restartToken;
    await delay(backoffMs);

    if (pendingRestart !== restartToken || stopRequested || options.signal?.aborted) {
      return;
    }

    pendingRestart = null;
    await launch(true);
  }

  async function transitionTo(status: ProcessState["status"]): Promise<void> {
    if (state.status === status) {
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

      state.restartCount = 0;
      void stateStore.write(spec.id, getState());
    }, 60_000);
  }

  function clearStableTimer(): void {
    if (stableTimer !== null) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }
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

function createRunSpec(spec: SupervisorOptions["spec"]): RunSpec {
  return {
    command: spec.command,
    args: spec.args,
    cwd: spec.cwd,
    env: spec.env,
    stderr: "pipe",
    stdout: "pipe"
  };
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

function delay(durationMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, durationMs);
  });
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

  const log = ((line: string, stream: "stdout" | "stderr") => {
    onLog?.(line, stream);

    for (const listener of listeners) {
      listener(line, stream);
    }
  }) as SubscribableLog;

  log.subscribe = listener => {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  };

  return log;
}

function pipeOutput(
  stream: NodeJS.ReadableStream | null,
  output: "stdout" | "stderr",
  write: (line: string, stream: "stdout" | "stderr") => Promise<void>,
  onLog: LogListener
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
          const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
          onLog(line, output);
          await write(line, output);
        });
      }
    });
    stream.once("end", () => {
      if (remainder.length > 0) {
        const finalLine = remainder.endsWith("\r") ? remainder.slice(0, -1) : remainder;
        writes = writes.then(async () => {
          onLog(finalLine, output);
          await write(finalLine, output);
        });
      }

      void writes.then(() => {
        resolve();
      }, reject);
    });
    stream.once("error", reject);
  });
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
