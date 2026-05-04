import nodeFs from "node:fs";
import type { FSWatcher } from "node:fs";
import type { LogChunk } from "./execution-env.js";

const JOB_DIR = "/tmp/poe-jobs";
const POLL_INTERVAL_MS = 250;

export interface LogStreamEnv {
  fs?: LogStreamFs;
}

export interface LogStreamFs {
  promises: {
    readFile(path: string): Promise<Buffer | string>;
    stat?(path: string): Promise<{ mtimeMs: number }>;
  };
  watch?: (path: string, listener: () => void) => FSWatcher;
}

export function wrapForLogTee(argv: string[], jobId: string): string[] {
  if (argv.length === 0) {
    throw new Error("wrapForLogTee requires argv to contain at least one argument");
  }

  const command = argv.map(shellQuote).join(" ");
  const logFile = shellQuote(jobLogPath(jobId));
  const exitFile = shellQuote(jobExitPath(jobId));
  const exitTmpFile = shellQuote(`${jobExitPath(jobId)}.tmp`);
  const script = [
    `mkdir -p ${shellQuote(JOB_DIR)}`,
    `({ (${command}); echo $? > ${exitTmpFile}; } 2>&1 | tee ${logFile}; mv ${exitTmpFile} ${exitFile})`
  ].join(" && ");

  return ["sh", "-c", script];
}

export async function* streamLogFile(
  env: LogStreamEnv,
  jobId: string,
  opts: { sinceByte?: number; since?: Date }
): AsyncIterable<LogChunk> {
  const fs = env.fs ?? nodeFs;
  const file = jobLogPath(jobId);
  let byteOffset = opts.sinceByte ?? 0;

  while (true) {
    if (opts.since !== undefined && !(await wasModifiedSince(fs, file, opts.since))) {
      await waitForLogChange(fs, file);
      continue;
    }

    const result = await readLogChunk(fs, file, byteOffset);
    if (result !== null) {
      byteOffset = result.nextByteOffset;
      yield result.chunk;
      continue;
    }

    await waitForLogChange(fs, file);
  }
}

async function wasModifiedSince(fs: LogStreamFs, file: string, since: Date): Promise<boolean> {
  if (fs.promises.stat === undefined) {
    return true;
  }

  try {
    const stat = await fs.promises.stat(file);
    return stat.mtimeMs >= since.getTime();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function waitForExit(
  env: LogStreamEnv,
  jobId: string,
  opts: { signal?: AbortSignal } = {}
): Promise<{ exitCode: number }> {
  const fs = env.fs ?? nodeFs;
  const file = jobExitPath(jobId);

  while (true) {
    throwIfAborted(opts.signal);
    const contents = await readTextFileIfExists(fs, file);
    if (contents !== null) {
      const text = contents.trim();
      const exitCode = Number(text);
      if (text.length === 0 || !Number.isInteger(exitCode)) {
        throw new Error(`Invalid exit code in ${file}: ${contents}`);
      }
      return { exitCode };
    }

    await sleep(POLL_INTERVAL_MS, opts.signal);
  }
}

function jobLogPath(jobId: string): string {
  return `${JOB_DIR}/${jobId}.log`;
}

function jobExitPath(jobId: string): string {
  return `${JOB_DIR}/${jobId}.exit`;
}

async function readLogChunk(
  fs: LogStreamFs,
  file: string,
  byteOffset: number
): Promise<{ chunk: LogChunk; nextByteOffset: number } | null> {
  const contents = await readFileIfExists(fs, file);
  if (contents === null || byteOffset >= contents.byteLength) {
    return null;
  }

  return {
    chunk: {
      byteOffset,
      data: contents.subarray(byteOffset).toString("utf8")
    },
    nextByteOffset: contents.byteLength
  };
}

async function readTextFileIfExists(fs: LogStreamFs, file: string): Promise<string | null> {
  const contents = await readFileIfExists(fs, file);
  return contents?.toString("utf8") ?? null;
}

async function readFileIfExists(fs: LogStreamFs, file: string): Promise<Buffer | null> {
  try {
    const contents = await fs.promises.readFile(file);
    return Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function waitForLogChange(fs: LogStreamFs, file: string): Promise<void> {
  const watch = fs.watch;
  if (typeof watch !== "function") {
    await sleep(POLL_INTERVAL_MS);
    return;
  }

  await new Promise<void>((resolve) => {
    let watcher: FSWatcher | null = null;
    const timer = setTimeout(done, POLL_INTERVAL_MS);

    function done(): void {
      clearTimeout(timer);
      watcher?.close();
      resolve();
    }

    try {
      watcher = watch(file, done);
    } catch {
      done();
    }
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    const abort = () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      reject(new Error("waitForExit aborted."));
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("waitForExit aborted.");
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
