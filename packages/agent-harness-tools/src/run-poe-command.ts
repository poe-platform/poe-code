import { randomBytes } from "node:crypto";
import { allAgents, resolveAgentId } from "@poe-code/agent-defs";
import type { StateManager } from "@poe-code/poe-code-config";
import type { RunHandle } from "@poe-code/process-runner";
import type { Readable } from "node:stream";
import { createBinaryExistsDetectors } from "./binary-exists.js";
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
    await Promise.all([pendingJob, upload]);
    await configureE2bSpawnAgentIfAvailable({
      env,
      openSpec: opts.openSpec,
      factoryType: opts.factory.type
    });
    const argv = wrapCommand
      ? wrapForLogTee(opts.openSpec.jobLabel.argv, jobId)
      : opts.openSpec.jobLabel.argv;
    const handle = execution?.tty
      ? env.shell()
      : env.exec({
          command: argv[0],
          args: argv.slice(1),
          cwd: opts.openSpec.cwd,
          env: resolveExecutionEnv(opts.openSpec),
          stdin: execution?.stdin ?? "inherit",
          stdout: execution?.stdout ?? "pipe",
          stderr: execution?.stderr ?? "pipe",
          signal: opts.signal
        });

    if (execution?.input !== undefined) {
      await writeExecutionInput(handle, execution.input);
    }

    const runningJob = opts.state.jobs.update(jobId, {
      status: "running",
      env_id: env.id,
      started_at: new Date().toISOString()
    });

    if (opts.detach) {
      await runningJob;
      setDetachedJobContext(env, {
        id: jobId,
        tool: opts.openSpec.jobLabel.tool,
        argv: opts.openSpec.jobLabel.argv
      });
      await env.detach();
      shouldClose = false;
      return { kind: "detached", jobId, envId: env.id };
    }

    const result = await runSync({
      env,
      handle,
      jobId,
      openSpec: opts.openSpec,
      signal: opts.signal,
      wrapCommand,
      closeAfterDownload: false
    });
    await runningJob;

    await opts.state.jobs.update(jobId, {
      status: "exited",
      exit_code: result.exitCode,
      exited_at: new Date().toISOString()
    });

    shouldClose = false;
    await env.close().catch(() => undefined);

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
  let closed = false;

  async function getEnv(openSpec: OpenSpec): Promise<OpenedEnv> {
    if (closed) {
      throw new Error("Cannot run command after Poe command session is closed.");
    }

    if (env !== null) {
      return env;
    }

    const opened = opts.factory.open(openSpec);
    env = isPromiseLike(opened) ? await opened : opened;
    await env.uploadWorkspace();
    return env;
  }

  return {
    async run(openSpec, signal) {
      const jobId = createUlid();
      const pendingJob = opts.state.jobs.put({
        id: jobId,
        env_id: "",
        env_kind: opts.factory.type,
        tool: openSpec.jobLabel.tool,
        argv: openSpec.jobLabel.argv,
        cwd: openSpec.cwd,
        started_at: "",
        status: "pending"
      });
      const currentEnv = await getEnv(openSpec);
      await pendingJob;
      await configureE2bSpawnAgentIfAvailable({
        env: currentEnv,
        openSpec,
        factoryType: opts.factory.type
      });
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
            signal
          });

      if (openSpec.execution?.input !== undefined) {
        await writeExecutionInput(handle, openSpec.execution.input);
      }

      await opts.state.jobs.update(jobId, {
        status: "running",
        env_id: currentEnv.id,
        started_at: new Date().toISOString()
      });

      const result = await runSync({
        env: currentEnv,
        handle,
        jobId,
        openSpec,
        signal,
        wrapCommand,
        closeAfterDownload: false
      });

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
      await env?.close();
    }
  };
}

async function configureE2bSpawnAgentIfAvailable(opts: {
  env: OpenedEnv;
  openSpec: OpenSpec;
  factoryType: string;
}): Promise<void> {
  if (opts.factoryType !== "e2b") {
    return;
  }

  const agentId = resolveAgentId(opts.openSpec.jobLabel.tool);
  const agent = allAgents.find((candidate) => candidate.id === agentId);
  const binaryName = agent?.binaryName;
  if (!agentId || !binaryName) {
    return;
  }

  const commandEnv = resolveExecutionEnv(opts.openSpec);
  const exists = await binaryExists(opts.env, {
    binaryName,
    cwd: opts.openSpec.cwd,
    env: commandEnv
  });
  if (!exists) {
    return;
  }

  const result = await runProbeCommand(opts.env, {
    command: "poe-code",
    args: ["configure", "--yes", "--provider", "poe", agentId],
    cwd: opts.openSpec.cwd,
    env: commandEnv
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to configure ${agentId} for Poe inside E2B sandbox.\n${formatProbeResult(result)}`
    );
  }
}

async function binaryExists(
  env: OpenedEnv,
  opts: { binaryName: string; cwd: string; env: Record<string, string> | undefined }
): Promise<boolean> {
  for (const detector of createBinaryExistsDetectors(opts.binaryName)) {
    const result = await runProbeCommand(env, {
      ...detector,
      cwd: opts.cwd,
      env: opts.env
    });
    if (detector.validate(result)) {
      return true;
    }
  }

  return false;
}

function resolveExecutionEnv(openSpec: OpenSpec): Record<string, string> | undefined {
  const execution = openSpec.execution;
  return execution?.env ?? openSpec.env;
}

async function runProbeCommand(
  env: OpenedEnv,
  spec: {
    command: string;
    args?: string[];
    cwd: string;
    env: Record<string, string> | undefined;
  }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const handle = env.exec({
    command: spec.command,
    args: spec.args,
    cwd: spec.cwd,
    env: spec.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe"
  });
  const stdout = readStream(handle.stdout);
  const stderr = readStream(handle.stderr);
  const result = await handle.result;
  return {
    exitCode: result.exitCode,
    stdout: await stdout,
    stderr: await stderr
  };
}

function readStream(stream: Readable | null): Promise<string> {
  if (!stream) {
    return Promise.resolve("");
  }
  return new Promise((resolve, reject) => {
    let output = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      output += chunk.toString();
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(output));
  });
}

function formatProbeResult(result: { exitCode: number; stdout: string; stderr: string }): string {
  return [
    `Exit code: ${result.exitCode}`,
    result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : "",
    result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : ""
  ]
    .filter(Boolean)
    .join("\n");
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
      waitForExit: async (env, jobId) => {
        await handle.result;
        if (timedOut) {
          throw createActivityTimeoutError(activityTimeoutMs!);
        }
        return waitForExit(toLogStreamEnv(env), jobId);
      },
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

      const result = await Promise.race([
        handle.result.then((value) => ({ kind: "exit" as const, value })),
        abortedPromise.then(() => ({ kind: "abort" as const }))
      ]);

      if (result.kind === "exit") {
        if (timedOut) {
          throw createActivityTimeoutError(activityTimeoutMs!);
        }
        if (aborted) {
          return result.value;
        }
        return waitForExit(toLogStreamEnv(env), jobId);
      }

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
      signal.removeEventListener("abort", kill);
    }
  };
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
      if (error.code === "EPIPE") {
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
