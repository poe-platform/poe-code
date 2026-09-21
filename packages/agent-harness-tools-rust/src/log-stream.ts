import nodeFs from "node:fs";
import type { FSWatcher } from "node:fs";
import {native} from "./native.js";
function hasOwnErrorCode(error:unknown,code:string):boolean {
 return typeof error==="object"&&error!==null&&Object.prototype.hasOwnProperty.call(error,"code")&&(error as {code?:unknown}).code===code;
}
import type { LogChunk } from "./log-types.js";

const JOB_DIR = "/tmp/poe-jobs";
const POLL_INTERVAL_MS = 250;

export interface LogStreamEnv {
  fs?: LogStreamFs;
}

export interface LogStreamFs {
  promises: {
    readFile(path: string): Promise<Buffer | string>;
    stat?(path: string): Promise<{ mtimeMs: number }>;
    lstat?(path: string): Promise<{ isSymbolicLink(): boolean }>;
  };
  watch?: (path: string, listener: () => void) => FSWatcher;
}

export function wrapForLogTee(argv: string[], jobId: string): string[] {
  assertSafeJobId(jobId);

  if (argv.length === 0) {
    throw new Error("wrapForLogTee requires argv to contain at least one argument");
  }

  return native.harnessLogTee(argv,jobId);
}

export async function* streamLogFile(
  env: LogStreamEnv,
  jobId: string,
  opts: { sinceByte?: number; since?: Date; follow?: boolean }
): AsyncIterable<LogChunk> {
  assertSafeJobId(jobId);

  const fs = env.fs ?? nodeFs;
  const file = jobLogPath(jobId);
  let byteOffset =
    opts.sinceByte ?? (opts.since === undefined ? 0 : await readCurrentByteLength(fs, file));
  let pendingBytes: Buffer = Buffer.alloc(0);
  let pendingByteOffset = byteOffset;

  while (true) {
    if (opts.since !== undefined && !(await wasModifiedSince(fs, file, opts.since))) {
      await waitForLogChange(fs, file);
      continue;
    }

    const result = await readLogChunk(fs, file, byteOffset);
    if (result !== null) {
      const combined =
        pendingBytes.length === 0 ? result.bytes : Buffer.concat([pendingBytes, result.bytes]);
      const completeLength = native.harnessUtf8Prefix(combined);
      byteOffset = result.nextByteOffset;
      pendingBytes = combined.subarray(completeLength);
      const data = combined.subarray(0, completeLength).toString("utf8");
      if (data.length > 0) {
        yield { byteOffset: pendingByteOffset, data };
        pendingByteOffset += completeLength;
      }
      continue;
    }

    if ((await readTextFileIfExists(fs, jobExitPath(jobId))) !== null) {
      return;
    }

    if (opts.follow === false) {
      return;
    }

    await waitForLogChange(fs, file);
  }
}

async function readCurrentByteLength(fs: LogStreamFs, file: string): Promise<number> {
  const contents = await readFileIfExists(fs, file);
  return contents?.byteLength ?? 0;
}

async function wasModifiedSince(fs: LogStreamFs, file: string, since: Date): Promise<boolean> {
  if (fs.promises.stat === undefined) {
    return true;
  }

  try {
    const stat = await fs.promises.stat(file);
    return stat.mtimeMs >= since.getTime();
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
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
  assertSafeJobId(jobId);

  const fs = env.fs ?? nodeFs;
  const file = jobExitPath(jobId);

  while (true) {
    throwIfAborted(opts.signal);
    const contents = await readTextFileIfExists(fs, file);
    if (contents !== null) {
      const text = contents.trim();
      const exitCode=native.harnessDecimalExitCode(text);
      if (exitCode===null) {
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

function assertSafeJobId(jobId: string): void {
  if (!native.harnessSafeJobId(jobId)) {
    throw new Error(`Invalid job id "${jobId}". Job ids must be single filename components.`);
  }
}

async function readLogChunk(
  fs: LogStreamFs,
  file: string,
  byteOffset: number
): Promise<{ bytes: Buffer; nextByteOffset: number } | null> {
  const contents = await readFileIfExists(fs, file);
  if (contents === null || byteOffset >= contents.byteLength) {
    return null;
  }

  return {
    bytes: contents.subarray(byteOffset),
    nextByteOffset: contents.byteLength
  };
}

async function readTextFileIfExists(fs: LogStreamFs, file: string): Promise<string | null> {
  const contents = await readFileIfExists(fs, file);
  return contents?.toString("utf8") ?? null;
}

async function readFileIfExists(fs: LogStreamFs, file: string): Promise<Buffer | null> {
  try {
    await assertRegularManagedFile(fs, file);
    const contents = await fs.promises.readFile(file);
    return Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function assertRegularManagedFile(fs: LogStreamFs, file: string): Promise<void> {
  const lstat = fs.promises.lstat;
  if (lstat === undefined) {
    return;
  }

  await assertManagedJobDirectory(lstat);

  try {
    if ((await lstat(file)).isSymbolicLink()) {
      throw new Error("Managed job file must not be a symbolic link.");
    }
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return;
    }

    throw error;
  }
}

async function assertManagedJobDirectory(
  lstat: NonNullable<LogStreamFs["promises"]["lstat"]>
): Promise<void> {
  try {
    if ((await lstat(JOB_DIR)).isSymbolicLink()) {
      throw new Error("Managed job directory must not be a symbolic link.");
    }
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return;
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
    let settled=false;
    const timer = setTimeout(done, POLL_INTERVAL_MS);

    function done(): void {
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      watcher?.close();
      resolve();
    }

    try {
      watcher = watch(file, done);
      if(settled)watcher.close();
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
