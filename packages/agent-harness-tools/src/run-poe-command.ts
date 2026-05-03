import { randomBytes } from "node:crypto";
import type { StateManager } from "@poe-code/poe-code-config";
import type { RunHandle } from "@poe-code/process-runner";
import type {
  DownloadResult,
  ExecutionEnvFactory,
  OpenedEnv,
  OpenSpec
} from "./execution-env.js";
import { waitForExit, wrapForLogTee, type LogStreamEnv } from "./log-stream.js";

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export async function runPoeCommand(opts: {
  factory: ExecutionEnvFactory;
  openSpec: OpenSpec;
  detach: boolean;
  state: StateManager;
  signal?: AbortSignal;
}): Promise<
  | { kind: "sync"; exitCode: number; download: DownloadResult }
  | { kind: "detached"; jobId: string; envId: string }
> {
  const jobId = createUlid();
  await opts.state.jobs.put({
    id: jobId,
    env_id: "",
    env_kind: opts.factory.type,
    tool: opts.openSpec.jobLabel.tool,
    argv: opts.openSpec.jobLabel.argv,
    cwd: opts.openSpec.cwd,
    started_at: "",
    status: "pending"
  });

  const env = await opts.factory.open(opts.openSpec);
  let shouldClose = true;

  try {
    await env.uploadWorkspace();
    const wrappedArgv = wrapForLogTee(opts.openSpec.jobLabel.argv, jobId);
    const handle = env.exec({
      command: wrappedArgv[0],
      args: wrappedArgv.slice(1),
      cwd: opts.openSpec.cwd,
      env: opts.openSpec.env,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
      signal: opts.signal
    });

    await opts.state.jobs.update(jobId, {
      status: "running",
      env_id: env.id,
      started_at: new Date().toISOString()
    });

    if (opts.detach) {
      shouldClose = false;
      return { kind: "detached", jobId, envId: env.id };
    }

    const result = await runSync({
      env,
      handle,
      jobId,
      openSpec: opts.openSpec,
      signal: opts.signal
    });
    shouldClose = false;

    await opts.state.jobs.update(jobId, {
      status: "exited",
      exit_code: result.exitCode,
      exited_at: new Date().toISOString()
    });

    return { kind: "sync", exitCode: result.exitCode, download: result.download };
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
}): Promise<{ exitCode: number; download: DownloadResult }> {
  opts.handle.stdout?.pipe(process.stdout, { end: false });
  opts.handle.stderr?.pipe(process.stderr, { end: false });
  const abort = createAbortSync(opts.signal, opts.handle);

  try {
    const { exitCode } = await abort.waitForExit(opts.env, opts.jobId);
    const download = await opts.env.downloadWorkspace({
      conflictPolicy: opts.openSpec.runner?.download_conflict ?? "refuse"
    });
    await opts.env.close();
    return { exitCode, download };
  } finally {
    abort.dispose();
    opts.handle.stdout?.unpipe(process.stdout);
    opts.handle.stderr?.unpipe(process.stderr);
  }
}

function createAbortSync(
  signal: AbortSignal | undefined,
  handle: RunHandle
): {
  waitForExit(env: OpenedEnv, jobId: string): Promise<{ exitCode: number }>;
  dispose(): void;
} {
  if (signal === undefined) {
    return {
      waitForExit: (env, jobId) => waitForExit(toLogStreamEnv(env), jobId),
      dispose() {}
    };
  }

  const exitWaitController = new AbortController();
  let aborted = signal.aborted;
  let notifyAbort!: () => void;
  const abortedPromise = new Promise<void>((resolve) => {
    notifyAbort = resolve;
  });
  const kill = () => {
    aborted = true;
    handle.kill("SIGTERM");
    notifyAbort();
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
    dispose() {
      exitWaitController.abort();
      signal.removeEventListener("abort", kill);
    }
  };
}

function toLogStreamEnv(env: OpenedEnv): LogStreamEnv {
  const candidate = env as OpenedEnv & LogStreamEnv;
  return candidate.fs === undefined ? {} : { fs: candidate.fs };
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
