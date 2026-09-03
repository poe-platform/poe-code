import { yieldTurn } from "../../contracts/yield.js";
import { collectBytes, readBytes, writeBytes, type ByteSource, type CommandContext, type FileStat } from "../../contracts/index.js";

export interface ArchiveLimits {
  readonly maxArchiveBytes: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
  readonly maxMembers: number;
  readonly maxPathBytes: number;
  readonly maxDepth: number;
  readonly maxPaxBytes: number;
  readonly maxFilesFromBytes: number;
  readonly maxArgumentBytes: number;
  readonly maxTextBytes: number;
  readonly maxDiagnosticBytes: number;
  readonly maxPatternSteps: number;
  readonly maxBufferedFileBytes: number;
  readonly chunkSize: number;
}

export interface ArchiveCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<ArchiveLimits>;
}

export const DEFAULT_ARCHIVE_LIMITS: Readonly<ArchiveLimits> = Object.freeze({
  maxArchiveBytes: 256 * 1024 * 1024,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxMembers: 10_000,
  maxPathBytes: 4096,
  maxDepth: 128,
  maxPaxBytes: 1024 * 1024,
  maxFilesFromBytes: 1024 * 1024,
  maxArgumentBytes: 64 * 1024,
  maxTextBytes: 1024 * 1024,
  maxDiagnosticBytes: 4096,
  maxPatternSteps: 10_000_000,
  maxBufferedFileBytes: 1024 * 1024,
  chunkSize: 64 * 1024,
});

export function settings(options: ArchiveCommandsOptions): ArchiveLimits {
  const limits = { ...DEFAULT_ARCHIVE_LIMITS, ...options.limits };
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(DEFAULT_ARCHIVE_LIMITS, key) || !Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid archive limit: ${key}`);
  }
  if (limits.chunkSize < 512 || limits.chunkSize > 1024 * 1024) throw new RangeError("Archive chunkSize must be between 512 and 1048576");
  return Object.freeze(limits);
}

export function fail(message: string): never { throw new Error(message); }

export function vfsPath(cwd: string, path: string): string {
  return path.startsWith("/") ? path : `${cwd === "/" ? "" : cwd}/${path}`;
}

export function wait<Value>(signal: AbortSignal, action: () => Value | PromiseLike<Value>): Promise<Value> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      Promise.resolve(action()).then(value => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      }, error => { signal.removeEventListener("abort", abort); reject(error); });
    } catch (error) { signal.removeEventListener("abort", abort); reject(error); }
  });
}

export function operation<Value>(context: CommandContext, action: () => Value | PromiseLike<Value>): Promise<Value> {
  return wait(context.signal, action);
}

export async function maybeStat(context: CommandContext, path: string): Promise<FileStat | undefined> {
  try { return await operation(context, () => context.fs.lstat(path, { signal: context.signal })); }
  catch (error) {
    context.signal.throwIfAborted();
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export function hasIdentity(stat: FileStat): boolean {
  return ((typeof stat.identityScope === "object" && stat.identityScope !== null) || typeof stat.identityScope === "symbol")
    && Number.isSafeInteger(stat.dev) && stat.dev! >= 0 && Number.isSafeInteger(stat.ino) && stat.ino! >= 0;
}

export function sameIdentity(first: FileStat, second: FileStat): boolean {
  return hasIdentity(first) && hasIdentity(second) && first.identityScope === second.identityScope && first.dev === second.dev && first.ino === second.ino;
}

export function text(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return fail("invalid UTF-8 archive name or metadata"); }
}

export function checkPath(path: string, limits: ArchiveLimits): void {
  if (!path || path.includes("\0") || Buffer.from(path).toString("utf8") !== path) fail("invalid empty, NUL, or non-Unicode path");
  if (Buffer.byteLength(path) > limits.maxPathBytes) fail("path byte limit exceeded");
  if (path.split("/").length > limits.maxDepth + 1) fail("path depth limit exceeded");
}

export function display(path: string): string {
  return path.replace(/[\\\x00-\x1f\x7f]/gu, character => {
    if (character === "\\") return "\\\\";
    if (character === "\n") return "\\n";
    if (character === "\r") return "\\r";
    if (character === "\t") return "\\t";
    return `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}`;
  });
}

export class Budget {
  members = 0;
  totalBytes = 0;
  textBytes = 0;
  constructor(readonly context: CommandContext, readonly limits: ArchiveLimits) {}
  async member(size = 0): Promise<void> {
    this.context.signal.throwIfAborted();
    if (++this.members > this.limits.maxMembers) fail("member/header limit exceeded");
    if (!Number.isSafeInteger(size) || size < 0 || size > this.limits.maxEntryBytes) fail("entry byte limit exceeded");
    if (size > this.limits.maxTotalBytes - this.totalBytes) fail("total payload byte limit exceeded");
    this.totalBytes += size;
    if (this.members % 128 === 0) await yieldTurn(this.context.signal);
  }
  async output(value: string, stderr = false): Promise<void> {
    const bytes = Buffer.from(value);
    if (bytes.length > this.limits.maxTextBytes - this.textBytes) fail("text output limit exceeded");
    this.textBytes += bytes.length;
    await writeBytes(stderr ? this.context.stderr : this.context.stdout, bytes, this.context.signal);
  }
}

export async function* bounded(source: ByteSource, maximum: number, signal: AbortSignal, chunkSize: number): ByteSource {
  let size = 0;
  let turns = 0;
  for await (const chunk of readBytes(source, signal)) {
    if (chunk.length > maximum - size) fail("archive byte limit exceeded");
    size += chunk.length;
    for (let offset = 0; offset < chunk.length; offset += chunkSize) {
      signal.throwIfAborted();
      yield chunk.subarray(offset, Math.min(chunk.length, offset + chunkSize));
    }
    if (++turns % 128 === 0) await yieldTurn(signal);
  }
}

export async function* fileSource(context: CommandContext, path: string, limits: ArchiveLimits): ByteSource {
  context.signal.throwIfAborted();
  if (context.fs.readStream) {
    yield* readBytes(context.fs.readStream(path, { signal: context.signal, chunkSize: limits.chunkSize }), context.signal);
  } else {
    const stat = await operation(context, () => context.fs.stat(path, { signal: context.signal }));
    if (stat.size > limits.maxBufferedFileBytes) fail("filesystem lacks streaming reads: buffered file limit exceeded");
    const bytes = await operation(context, () => context.fs.readFile(path, { signal: context.signal, maxBytes: limits.maxBufferedFileBytes }));
    if (bytes.length > limits.maxBufferedFileBytes) fail("buffered file limit exceeded");
    yield bytes;
  }
}

export async function publish(context: CommandContext, path: string, source: ByteSource, mode = 0o600): Promise<void> {
  const options = { signal: context.signal, flag: "wx" as const, mode };
  if (context.fs.writeStream) {
    let finished = false;
    const observed = (async function* () { yield* readBytes(source, context.signal); finished = true; })();
    try {
      await operation(context, () => context.fs.writeStream!(path, observed, options));
      if (!finished) fail("filesystem writeStream returned before consuming its source");
    } finally { void observed.return(undefined).catch(() => {}); }
  } else {
    await operation(context, () => context.fs.writeFile(path, new Uint8Array(), options));
    for await (const chunk of readBytes(source, context.signal)) {
      await operation(context, () => context.fs.appendFile(path, chunk, { signal: context.signal }));
    }
  }
}

export async function smallFile(context: CommandContext, path: string, limits: ArchiveLimits): Promise<Uint8Array> {
  return collectBytes(fileSource(context, path, limits), { signal: context.signal, maxBytes: limits.maxFilesFromBytes });
}
