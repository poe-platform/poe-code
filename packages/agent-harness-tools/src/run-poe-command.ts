import { randomBytes } from "node:crypto";
import type { StateManager } from "@poe-code/poe-code-config";
import type { RunHandle } from "@poe-code/process-runner";
import type { Readable } from "node:stream";
import type { DownloadResult, ExecutionEnvFactory, OpenedEnv, OpenSpec } from "./execution-env.js";
import { waitForExit, wrapForLogTee, type LogStreamEnv } from "./log-stream.js";

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

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
  const jobId = createUlid();
  const execution = opts.openSpec.execution;
  const wrapCommand = execution?.wrapForLogTee !== false;
  const pendingJob = opts.state.jobs.put({
    id: jobId,
    env_id: "",
    env_kind: opts.factory.type,
    tool: opts.openSpec.jobLabel.tool,
    argv: opts.openSpec.jobLabel.argv,
    cwd: opts.openSpec.cwd,
    started_at: "",
    status: "pending"
  });

  const opened = opts.factory.open(opts.openSpec);
  const env = isPromiseLike(opened) ? await opened : opened;
  let shouldClose = true;

  try {
    const upload = env.uploadWorkspace();
    const argv = wrapCommand
      ? wrapForLogTee(opts.openSpec.jobLabel.argv, jobId)
      : opts.openSpec.jobLabel.argv;
    const handle = execution?.tty
      ? env.shell()
      : env.exec({
          command: argv[0],
          args: argv.slice(1),
          cwd: opts.openSpec.cwd,
          env: execution && "env" in execution ? execution.env : opts.openSpec.env,
          stdin: execution?.stdin ?? "inherit",
          stdout: execution?.stdout ?? "pipe",
          stderr: execution?.stderr ?? "pipe",
          signal: opts.signal
        });

    if (execution?.input !== undefined) {
      handle.stdin?.setDefaultEncoding("utf8");
      handle.stdin?.end(execution.input);
    }

    const runningJob = Promise.all([pendingJob, upload]).then(() =>
      opts.state.jobs.update(jobId, {
        status: "running",
        env_id: env.id,
        started_at: new Date().toISOString()
      })
    );

    if (opts.detach) {
      await runningJob;
      shouldClose = false;
      return { kind: "detached", jobId, envId: env.id };
    }

    const result = await runSync({
      env,
      handle,
      jobId,
      openSpec: opts.openSpec,
      signal: opts.signal,
      wrapCommand
    });
    await runningJob;
    shouldClose = false;

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
  } finally {
    if (shouldClose) {
      await env.close();
    }
  }
}

async function runSync(opts: {
  env: OpenedEnv;
  handle: RunHandle;
  jobId: string;
  openSpec: OpenSpec;
  signal?: AbortSignal;
  wrapCommand: boolean;
}): Promise<{ exitCode: number; download: DownloadResult; stdout?: string; stderr?: string }> {
  const execution = opts.openSpec.execution;
  const capture = execution?.captureOutput === true;
  const abort = createAbortSync(opts.signal, opts.handle, execution?.activityTimeoutMs);
  const streamState = capture
    ? captureRunStreams(opts.handle, execution, abort.resetActivityTimer)
    : pipeRunStreams(opts.handle);
  abort.resetActivityTimer();

  try {
    const { exitCode } = opts.wrapCommand
      ? await abort.waitForExit(opts.env, opts.jobId)
      : await abort.waitForHandle();
    const download = await opts.env.downloadWorkspace({
      conflictPolicy: opts.openSpec.runner?.download_conflict ?? "refuse"
    });
    await opts.env.close();
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

function pipeRunStreams(handle: RunHandle): {
  stdout(): string;
  stderr(): string;
  dispose(): void;
} {
  handle.stdout?.pipe(process.stdout, { end: false });
  handle.stderr?.pipe(process.stderr, { end: false });
  return {
    stdout: () => "",
    stderr: () => "",
    dispose() {
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
  dispose(): void;
} {
  let stdout = "";
  let stderr = "";
  const listeners: Array<() => void> = [];

  const bind = (stream: Readable | null, onChunk: (chunk: string) => void): void => {
    if (!stream) return;
    stream.setEncoding("utf8");
    const listener = (chunk: string | Buffer) => {
      onActivity();
      onChunk(chunk.toString());
    };
    stream.on("data", listener);
    listeners.push(() => {
      stream.off("data", listener);
    });
  };

  bind(handle.stdout, (chunk) => {
    stdout += chunk;
    execution?.onStdout?.(chunk);
  });
  bind(handle.stderr, (chunk) => {
    stderr += chunk;
    execution?.onStderr?.(chunk);
  });

  return {
    stdout: () => stdout,
    stderr: () => stderr,
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
  activityTimeoutMs: number | undefined
): {
  waitForExit(env: OpenedEnv, jobId: string): Promise<{ exitCode: number }>;
  waitForHandle(): Promise<{ exitCode: number }>;
  resetActivityTimer(): void;
  dispose(): void;
} {
  let activityTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const resetActivityTimer = activityTimeoutMs
    ? () => {
        if (activityTimer) clearTimeout(activityTimer);
        activityTimer = setTimeout(() => {
          timedOut = true;
          handle.kill("SIGTERM");
          notifyAbort?.();
        }, activityTimeoutMs);
      }
    : () => {};
  let notifyAbort: (() => void) | undefined;

  if (signal === undefined) {
    return {
      waitForExit: (env, jobId) => waitForExit(toLogStreamEnv(env), jobId),
      waitForHandle: async () => {
        const result = await handle.result;
        if (timedOut) {
          throw createActivityTimeoutError(activityTimeoutMs!);
        }
        return result;
      },
      resetActivityTimer,
      dispose() {
        if (activityTimer) clearTimeout(activityTimer);
      }
    };
  }

  const exitWaitController = new AbortController();
  let aborted = signal.aborted;
  const abortedPromise = new Promise<void>((resolve) => {
    notifyAbort = resolve;
  });
  const kill = () => {
    aborted = true;
    handle.kill("SIGTERM");
    notifyAbort?.();
  };

  if (signal.aborted) {
    kill();
  } else {
    signal.addEventListener("abort", kill, { once: true });
  }

  return {
    async waitForExit(env, jobId) {
      if (aborted) {
        return handle.result;
      }

      const exit = waitForExit(toLogStreamEnv(env), jobId, {
        signal: exitWaitController.signal
      }).then(
        (value) => ({ kind: "exit" as const, value }),
        (error: unknown) => ({ kind: "error" as const, error })
      );
      const result = await Promise.race([
        exit,
        abortedPromise.then(() => ({ kind: "abort" as const }))
      ]);

      if (result.kind === "exit") {
        return result.value;
      }

      if (result.kind === "error") {
        throw result.error;
      }

      exitWaitController.abort();
      return handle.result;
    },
    async waitForHandle() {
      const result = await Promise.race([
        handle.result.then((value) => ({ kind: "exit" as const, value })),
        abortedPromise.then(() => ({ kind: "abort" as const }))
      ]);

      if (result.kind === "exit") {
        if (aborted) {
          throw createAbortError();
        }
        if (timedOut) {
          throw createActivityTimeoutError(activityTimeoutMs!);
        }
        return result.value;
      }

      if (timedOut) {
        throw createActivityTimeoutError(activityTimeoutMs!);
      }
      throw createAbortError();
    },
    resetActivityTimer,
    dispose() {
      if (activityTimer) clearTimeout(activityTimer);
      exitWaitController.abort();
      signal.removeEventListener("abort", kill);
    }
  };
}

function toLogStreamEnv(env: OpenedEnv): LogStreamEnv {
  const candidate = env as OpenedEnv & LogStreamEnv;
  return candidate.fs === undefined ? {} : { fs: candidate.fs };
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
