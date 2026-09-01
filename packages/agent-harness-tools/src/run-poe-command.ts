import { randomBytes } from "node:crypto";
import type { StateManager } from "@poe-code/poe-code-config/core";
import type { RunHandle } from "@poe-code/process-runner";
import type { Readable } from "node:stream";
import { hasOwnErrorCode } from "./error-codes.js";
import type { DownloadResult, ExecutionEnvFactory, OpenedEnv, OpenSpec } from "./execution-env.js";
import { waitForExit, wrapForLogTee, type LogStreamEnv } from "./log-stream.js";

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const WRAPPED_COMMAND_FORCE_KILL_GRACE_MS = 250;

export async function runPoeCommand(opts: {
  factory: ExecutionEnvFactory;
  openSpec: OpenSpec;
  detach: boolean;
  state: StateManager;
  signal?: AbortSignal;
}): Promise<
  | {
      kind: "sync";
      exitCode: number;
      download: DownloadResult;
      stdout?: string;
      stderr?: string;
    }
  | { kind: "detached"; jobId: string; envId: string }
> {
  validateActivityTimeout(opts.openSpec.execution?.activityTimeoutMs);
  const jobId = createUlid();
  const execution = opts.openSpec.execution;
  const wrapCommand = execution?.wrapForLogTee !== false;
  const displayArgv = getDisplayArgv(opts.openSpec);
  const pendingJob = opts.state.jobs.put({
    id: jobId,
    env_id: "",
    env_kind: opts.factory.type,
    tool: opts.openSpec.jobLabel.tool,
    argv: displayArgv,
    cwd: opts.openSpec.cwd,
    started_at: "",
    status: "pending"
  });

  let env: OpenedEnv | null = null;
  let handle: RunHandle | null = null;
  let jobPhase: "pending" | "running" | "terminal" = "pending";
  let shouldClose = false;

  try {
    const opened = opts.factory.open(opts.openSpec);
    env = isPromiseLike(opened) ? await opened : opened;
    shouldClose = true;
    const upload = env.uploadWorkspace();
    await Promise.all([pendingJob, upload]);
    const argv = wrapCommand
      ? wrapForLogTee(opts.openSpec.jobLabel.argv, jobId)
      : opts.openSpec.jobLabel.argv;
    handle = execution?.tty
      ? env.shell()
      : env.exec({
          command: argv[0],
          args: argv.slice(1),
          cwd: opts.openSpec.cwd,
          env: resolveExecutionEnv(opts.openSpec),
          stdin: execution?.stdin ?? "inherit",
          stdout: execution?.stdout ?? "pipe",
          stderr: execution?.stderr ?? "pipe",
          signal: opts.signal,
          killProcessGroup:
            wrapCommand || opts.signal !== undefined || execution?.activityTimeoutMs !== undefined
              ? true
              : undefined
        });
    const running = opts.detach
      ? undefined
      : settleRunSync(runSync({
          env,
          handle,
          jobId,
          openSpec: opts.openSpec,
          signal: opts.signal,
          wrapCommand,
          closeAfterDownload: false
        }));

    if (execution?.input !== undefined) {
      await writeExecutionInput(handle, execution.input);
    }

    await opts.state.jobs.update(jobId, {
      status: "running",
      env_id: env.id,
      started_at: new Date().toISOString(),
      ...(opts.detach && env.reattachContext !== undefined
        ? { reattach_context: env.reattachContext }
        : {})
    });
    jobPhase = "running";

    if (opts.detach) {
      setDetachedJobContext(env, {
        id: jobId,
        tool: opts.openSpec.jobLabel.tool,
        argv: displayArgv
      });
      await env.detach();
      shouldClose = false;
      return { kind: "detached", jobId, envId: env.id };
    }

    const result = unwrapSettledRun(await running!);

    await opts.state.jobs.update(jobId, {
      status: "exited",
      exit_code: result.exitCode,
      exited_at: new Date().toISOString()
    });
    jobPhase = "terminal";

    shouldClose = false;
    await env.close().catch(() => undefined);

    return {
      kind: "sync",
      exitCode: result.exitCode,
      download: result.download,
      ...(result.stdout !== undefined ? { stdout: result.stdout } : {}),
      ...(result.stderr !== undefined ? { stderr: result.stderr } : {})
    };
  } catch (error) {
    await pendingJob.catch(() => undefined);
    if (jobPhase === "pending") {
      if (handle !== null) {
        tryKill(handle, "SIGTERM");
      }
      await opts.state.jobs.remove(jobId).catch(() => undefined);
    } else if (jobPhase === "running") {
      await opts.state.jobs.update(jobId, {
        status: "lost",
        exited_at: new Date().toISOString()
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    if (shouldClose && env !== null) {
      await env.close();
    }
  }
}

export interface PoeCommandSession {
  run(
    openSpec: OpenSpec,
    signal?: AbortSignal
  ): Promise<{
    kind: "sync";
    exitCode: number;
    download: DownloadResult;
    stdout?: string;
    stderr?: string;
  }>;
  close(): Promise<void>;
}

export function createPoeCommandSession(opts: {
  factory: ExecutionEnvFactory;
  state: StateManager;
}): PoeCommandSession {
  let env: OpenedEnv | null = null;
  let openedEnv: OpenedEnv | null = null;
  let closed = false;

  async function getEnv(openSpec: OpenSpec): Promise<OpenedEnv> {
    if (closed) {
      throw new Error("Cannot run command after Poe command session is closed.");
    }

    if (env !== null) {
      return env;
    }

    if (openedEnv === null) {
      const opened = opts.factory.open(openSpec);
      openedEnv = isPromiseLike(opened) ? await opened : opened;
    }

    await openedEnv.uploadWorkspace();
    env = openedEnv;
    return openedEnv;
  }

  return {
    async run(openSpec, signal) {
      validateActivityTimeout(openSpec.execution?.activityTimeoutMs);
      const jobId = createUlid();
      const displayArgv = getDisplayArgv(openSpec);
      const pendingJob = opts.state.jobs.put({
        id: jobId,
        env_id: "",
        env_kind: opts.factory.type,
        tool: openSpec.jobLabel.tool,
        argv: displayArgv,
        cwd: openSpec.cwd,
        started_at: "",
        status: "pending"
      });
      const currentEnv = await getEnv(openSpec);
      await pendingJob;
      const wrapCommand = openSpec.execution?.wrapForLogTee !== false;
      const argv = wrapCommand
        ? wrapForLogTee(openSpec.jobLabel.argv, jobId)
        : openSpec.jobLabel.argv;
      const handle = openSpec.execution?.tty
        ? currentEnv.shell()
        : currentEnv.exec({
            command: argv[0],
            args: argv.slice(1),
            cwd: openSpec.cwd,
            env: resolveExecutionEnv(openSpec),
            stdin: openSpec.execution?.stdin ?? "inherit",
            stdout: openSpec.execution?.stdout ?? "pipe",
            stderr: openSpec.execution?.stderr ?? "pipe",
            signal,
            killProcessGroup:
              wrapCommand || signal !== undefined || openSpec.execution?.activityTimeoutMs !== undefined
                ? true
                : undefined
          });
      const running = settleRunSync(runSync({
        env: currentEnv,
        handle,
        jobId,
        openSpec,
        signal,
        wrapCommand,
        closeAfterDownload: false
      }));

      if (openSpec.execution?.input !== undefined) {
        await writeExecutionInput(handle, openSpec.execution.input);
      }

      await opts.state.jobs.update(jobId, {
        status: "running",
        env_id: currentEnv.id,
        started_at: new Date().toISOString()
      });

      const result = unwrapSettledRun(await running);

      await opts.state.jobs.update(jobId, {
        status: "exited",
        exit_code: result.exitCode,
        exited_at: new Date().toISOString()
      });

      return {
        kind: "sync",
        exitCode: result.exitCode,
        download: result.download,
        ...(result.stdout !== undefined ? { stdout: result.stdout } : {}),
        ...(result.stderr !== undefined ? { stderr: result.stderr } : {})
      };
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await (env ?? openedEnv)?.close();
    }
  };
}

function getDisplayArgv(openSpec: OpenSpec): string[] {
  return openSpec.jobLabel.displayArgv ?? openSpec.jobLabel.argv;
}

function validateActivityTimeout(activityTimeoutMs: number | undefined): void {
  if (
    activityTimeoutMs !== undefined &&
    (!Number.isFinite(activityTimeoutMs) || activityTimeoutMs <= 0)
  ) {
    throw new Error("activityTimeoutMs must be a finite positive number");
  }
}

function resolveExecutionEnv(openSpec: OpenSpec): Record<string, string> | undefined {
  return openSpec.execution?.env ?? openSpec.env;
}

async function runSync(opts: {
  env: OpenedEnv;
  handle: RunHandle;
  jobId: string;
  openSpec: OpenSpec;
  signal?: AbortSignal;
  wrapCommand: boolean;
  closeAfterDownload?: boolean;
}): Promise<{ exitCode: number; download: DownloadResult; stdout?: string; stderr?: string }> {
  const execution = opts.openSpec.execution;
  const capture = execution?.captureOutput === true;
  const abort = createAbortSync(opts.signal, opts.handle, execution?.activityTimeoutMs, {
    forceKillAfterMs: WRAPPED_COMMAND_FORCE_KILL_GRACE_MS
  });
  const streamState = capture
    ? captureRunStreams(opts.handle, execution, abort.resetActivityTimer)
    : pipeRunStreams(opts.handle, abort.resetActivityTimer);
  abort.resetActivityTimer();

  try {
    const { exitCode } = opts.wrapCommand
      ? await abort.waitForExit(opts.env, opts.jobId)
      : await abort.waitForHandle();
    if (capture) {
      await abort.waitForDrain(streamState.drained());
    }
    const download = await opts.env.downloadWorkspace({
      conflictPolicy: opts.openSpec.runner?.download_conflict ?? "refuse"
    });
    if (opts.closeAfterDownload !== false) {
      await opts.env.close();
    }
    return {
      exitCode,
      download,
      ...(capture ? { stdout: streamState.stdout(), stderr: streamState.stderr() } : {})
    };
  } finally {
    abort.dispose();
    streamState.dispose();
  }
}

type SyncRunResult = Awaited<ReturnType<typeof runSync>>;
type SettledSyncRun =
  | { status: "fulfilled"; value: SyncRunResult }
  | { status: "rejected"; reason: unknown };

function settleRunSync(result: Promise<SyncRunResult>): Promise<SettledSyncRun> {
  return result.then(
    (value) => ({ status: "fulfilled", value }),
    (reason: unknown) => ({ status: "rejected", reason })
  );
}

function unwrapSettledRun(result: SettledSyncRun): SyncRunResult {
  if (result.status === "rejected") {
    throw result.reason;
  }

  return result.value;
}

function pipeRunStreams(
  handle: RunHandle,
  onActivity: () => void
): {
  stdout(): string;
  stderr(): string;
  drained(): Promise<void>;
  dispose(): void;
} {
  const listeners: Array<() => void> = [];
  const bindActivity = (stream: Readable | null): void => {
    if (!stream) return;
    const listener = () => {
      onActivity();
    };
    stream.on("data", listener);
    listeners.push(() => {
      stream.off("data", listener);
    });
  };

  bindActivity(handle.stdout);
  bindActivity(handle.stderr);
  handle.stdout?.pipe(process.stdout, { end: false });
  handle.stderr?.pipe(process.stderr, { end: false });
  return {
    stdout: () => "",
    stderr: () => "",
    drained: () => Promise.resolve(),
    dispose() {
      for (const remove of listeners) {
        remove();
      }
      handle.stdout?.unpipe(process.stdout);
      handle.stderr?.unpipe(process.stderr);
    }
  };
}

function captureRunStreams(
  handle: RunHandle,
  execution: NonNullable<OpenSpec["execution"]> | undefined,
  onActivity: () => void
): {
  stdout(): string;
  stderr(): string;
  drained(): Promise<void>;
  dispose(): void;
} {
  let stdout = "";
  let stderr = "";
  const listeners: Array<() => void> = [];
  const drainPromises: Array<Promise<void>> = [];

  const bind = (
    stream: Readable | null,
    onChunk: (chunk: string) => void,
    countsAsActivity: boolean
  ): void => {
    if (!stream) return;
    stream.setEncoding("utf8");
    let settled = false;
    let settleDrain = () => {};
    const listener = (chunk: string | Buffer) => {
      if (countsAsActivity) {
        onActivity();
      }
      onChunk(chunk.toString());
    };
    const drainPromise = new Promise<void>((resolve) => {
      settleDrain = () => {
        if (settled) {
          return;
        }

        settled = true;
        stream.off("end", settleDrain);
        stream.off("close", settleDrain);
        stream.off("error", settleDrain);
        resolve();
      };
    });
    stream.on("data", listener);
    stream.once("end", settleDrain);
    stream.once("close", settleDrain);
    stream.once("error", settleDrain);
    drainPromises.push(drainPromise);
    listeners.push(() => {
      stream.off("data", listener);
      settleDrain();
    });
  };

  bind(handle.stdout, (chunk) => {
    stdout += chunk;
    execution?.onStdout?.(chunk);
  }, true);
  bind(handle.stderr, (chunk) => {
    stderr += chunk;
    execution?.onStderr?.(chunk);
  }, execution?.activityTimeoutSource !== "stdout");

  return {
    stdout: () => stdout,
    stderr: () => stderr,
    drained: async () => {
      await Promise.all(drainPromises);
    },
    dispose() {
      for (const remove of listeners) {
        remove();
      }
    }
  };
}

function createAbortSync(
  signal: AbortSignal | undefined,
  handle: RunHandle,
  activityTimeoutMs: number | undefined,
  opts: { forceKillAfterMs?: number } = {}
): {
  waitForExit(env: OpenedEnv, jobId: string): Promise<{ exitCode: number }>;
  waitForHandle(): Promise<{ exitCode: number }>;
  waitForDrain(drain: Promise<void>): Promise<void>;
  resetActivityTimer(): void;
  dispose(): void;
} {
  let activityTimer: ReturnType<typeof setTimeout> | undefined;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  let terminationError: Error | undefined;
  let notifyTermination: (() => void) | undefined;
  const terminationPromise = new Promise<void>((resolve) => {
    notifyTermination = resolve;
  });
  const exitWaitController = new AbortController();
  const terminate = (error: Error): void => {
    if (terminationError !== undefined) return;
    terminationError = error;
    notifyTermination?.();
    tryKill(handle, "SIGTERM");
    if (opts.forceKillAfterMs !== undefined) {
      forceKillTimer = setTimeout(() => {
        tryKill(handle, "SIGKILL");
      }, opts.forceKillAfterMs);
      forceKillTimer.unref?.();
    }
  };
  const resetActivityTimer = activityTimeoutMs
    ? () => {
        if (activityTimer) clearTimeout(activityTimer);
        activityTimer = setTimeout(() => {
          terminate(createActivityTimeoutError(activityTimeoutMs));
        }, activityTimeoutMs);
      }
    : () => {};
  const abort = () => terminate(createAbortError());

  if (signal?.aborted) {
    abort();
  } else {
    signal?.addEventListener("abort", abort, { once: true });
  }

  return {
    async waitForExit(env, jobId) {
      if (terminationError !== undefined) throw terminationError;

      const exit = waitForExit(toLogStreamEnv(env), jobId, {
        signal: exitWaitController.signal
      }).then(
        (value) => ({ kind: "exit" as const, value }),
        (error: unknown) => ({ kind: "error" as const, error })
      );
      const result = await Promise.race([
        exit,
        terminationPromise.then(() => ({ kind: "terminate" as const }))
      ]);

      if (result.kind === "exit") {
        return result.value;
      }

      if (result.kind === "error") {
        throw result.error;
      }

      exitWaitController.abort();
      throw terminationError!;
    },
    async waitForHandle() {
      if (terminationError !== undefined) throw terminationError;

      const result = await Promise.race([
        handle.result.then((value) => ({ kind: "exit" as const, value })),
        terminationPromise.then(() => ({ kind: "terminate" as const }))
      ]);

      if (result.kind === "exit") {
        return result.value;
      }

      throw terminationError!;
    },
    async waitForDrain(drain) {
      if (terminationError !== undefined) throw terminationError;

      const result = await Promise.race([
        drain.then(() => ({ kind: "drained" as const })),
        terminationPromise.then(() => ({ kind: "terminate" as const }))
      ]);

      if (result.kind === "drained") {
        return;
      }

      throw terminationError!;
    },
    resetActivityTimer,
    dispose() {
      if (activityTimer) clearTimeout(activityTimer);
      if (terminationError === undefined && forceKillTimer) clearTimeout(forceKillTimer);
      exitWaitController.abort();
      signal?.removeEventListener("abort", abort);
    }
  };
}

function tryKill(handle: RunHandle, signal: NodeJS.Signals): void {
  try {
    handle.kill(signal);
  } catch {
    return;
  }
}

function toLogStreamEnv(env: OpenedEnv): LogStreamEnv {
  const candidate = env as OpenedEnv & LogStreamEnv;
  return candidate.fs === undefined ? {} : { fs: candidate.fs };
}

function setDetachedJobContext(
  env: OpenedEnv,
  context: { id: string; tool: string; argv: string[] }
): void {
  const candidate = env as OpenedEnv & {
    setDetachedJobContext?: (value: { id: string; tool: string; argv: string[] }) => void;
  };
  candidate.setDetachedJobContext?.(context);
}

async function writeExecutionInput(handle: RunHandle, input: string | Buffer): Promise<void> {
  const stdin = handle.stdin;
  if (stdin === null) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (hasOwnErrorCode(error, "EPIPE")) {
        resolve();
        return;
      }
      reject(error);
    });
    stdin.setDefaultEncoding("utf8");
    stdin.end(input, resolve);
  });
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>).then === "function";
}

function createAbortError(): Error {
  const error = new Error("Agent spawn aborted");
  error.name = "AbortError";
  return error;
}

function createActivityTimeoutError(timeoutMs: number): Error {
  const error = new Error(`Agent spawn timed out after ${timeoutMs / 1000}s of inactivity`);
  error.name = "ActivityTimeoutError";
  return error;
}

function createUlid(): string {
  const time = BigInt(Date.now());
  const random = randomBytes(10);
  let randomValue = 0n;

  for (const byte of random) {
    randomValue = (randomValue << 8n) | BigInt(byte);
  }

  return encodeBase32(time, 10) + encodeBase32(randomValue, 16);
}

function encodeBase32(value: bigint, length: number): string {
  const chars = Array.from({ length }, () => "0");
  let remaining = value;

  for (let index = length - 1; index >= 0; index -= 1) {
    chars[index] = ULID_ALPHABET[Number(remaining & 31n)];
    remaining >>= 5n;
  }

  return chars.join("");
}
