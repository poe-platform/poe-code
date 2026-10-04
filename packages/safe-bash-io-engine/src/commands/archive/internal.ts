import { readFileStream } from "safe-bash-contracts/filesystem";
import { subscribeAbort } from "safe-bash-contracts";
import { bytesFrom, utf8ByteLength } from "safe-bash-byte-engine";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { yieldTurn } from "safe-bash-contracts/yield";
import { collectBytes, InputByteBudget, readBytes, writeBytes, type ByteSource, type CommandContext, type CommandResult, type FileStat, type FileSystem } from "safe-bash-contracts";

const archiveInputs = new WeakMap<FileSystem, { fs: FileSystem; budget: InputByteBudget }>();

/** Keep generated scratch IO separate from cumulative external input admission. */
export function withArchiveInputByteBudget(execute: (context: CommandContext) => Promise<CommandResult>): (context: CommandContext) => Promise<CommandResult> {
  return context => {
    if (!context.inputBudget) return execute(context);
    const budget = new InputByteBudget(Infinity, context.inputBudget);
    return budget.run(context, async limited => {
      archiveInputs.set(limited.fs, { fs: context.fs, budget });
      try { return await execute(limited); }
      finally { archiveInputs.delete(limited.fs); }
    });
  };
}

/** Only invocation-owned scratch and version-checked retained ranges use this view. */
export function archiveStorageContext(context: CommandContext): CommandContext {
  const input = archiveInputs.get(context.fs);
  return input ? { ...context, fs: input.fs } : context;
}

/** Admit a retained archive once; its version and range bounds remain checked on reads. */
export function admitArchiveInput(context: CommandContext, size: number): void {
  archiveInputs.get(context.fs)?.budget.charge(size);
}

export interface ArchiveLimits {
  readonly maxArchiveBytes: number;
  /** ZIP input collection peak, including backing slabs and replacement buffers. */
  readonly maxInputMemoryBytes: number;
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
  readonly limits?: { readonly [K in keyof ArchiveLimits]?: ArchiveLimits[K] | undefined };
  /** Explicit trusted host capabilities; neither capability reads shell stdin. */
  readonly zipHost?: ZipHost;
  /** Defaults for creation; CLI -Z and --encryption override these. */
  readonly zip?: Readonly<{ compression?: "store" | "deflate" | "bzip2" | "lzma"; encryption?: ZipEncryptionProfile }>;
}

export type ZipEncryptionProfile = "zipcrypto" | "aes-128-ae1" | "aes-128-ae2" | "aes-192-ae1" | "aes-192-ae2" | "aes-256-ae1" | "aes-256-ae2";

export interface ZipHost {
  /** Resolve a zero-based input disk to an explicit VFS path. No directory discovery. */
  readonly volume?: (request: Readonly<{ archive: string; disk: number; disks: number; signal: AbortSignal }>) => string | undefined | Promise<string | undefined>;
  /** Approve a staged volume transition; false/EOF cancels before publication. */
  readonly volumePrompt?: (request: Readonly<{ path: string; disk: number; disks: number; signal: AbortSignal }>) => boolean | Promise<boolean>;
  /** Supply cryptographically secure, fresh bytes. Product code never substitutes entropy. */
  readonly entropy?: (length: number, signal: AbortSignal) => Uint8Array | Promise<Uint8Array>;
  /** Host must suppress terminal echo and return owned password bytes, or undefined on EOF. */
  readonly password?: (request: Readonly<{ prompt: string; maxBytes: number; signal: AbortSignal}>) => Promise<Uint8Array | undefined>;
}

export const DEFAULT_ARCHIVE_LIMITS: Readonly<ArchiveLimits> = Object.freeze({
  maxArchiveBytes: Infinity,
  maxInputMemoryBytes: Infinity,
  maxEntryBytes: Infinity,
  maxTotalBytes: Infinity,
  maxMembers: Infinity,
  maxPathBytes: Infinity,
  maxDepth: Infinity,
  maxPaxBytes: Infinity,
  maxFilesFromBytes: Infinity,
  maxArgumentBytes: Infinity,
  maxTextBytes: Infinity,
  maxDiagnosticBytes: Infinity,
  maxPatternSteps: Infinity,
  maxBufferedFileBytes: Infinity,
  chunkSize: 64 * 1024,
});

export function settings(options: ArchiveCommandsOptions): ArchiveLimits {
  const limits = { ...DEFAULT_ARCHIVE_LIMITS };
  for (const [key, value] of Object.entries(options.limits ?? {})) {
    if (!Object.hasOwn(DEFAULT_ARCHIVE_LIMITS, key) || (value !== undefined && value !== Infinity && (!Number.isSafeInteger(value) || value < 1))) {
      throw new RangeError(`Invalid archive limit: ${key}`);
    }
    if (value !== undefined) limits[key as keyof ArchiveLimits] = value;
  }
  if (limits.chunkSize === Infinity) limits.chunkSize = DEFAULT_ARCHIVE_LIMITS.chunkSize;
  if (limits.chunkSize < 512 || limits.chunkSize > 1024 * 1024) throw new RangeError("Archive chunkSize must be between 512 and 1048576");
  return Object.freeze(limits);
}

export function invocationLimits(configured: ArchiveLimits, context: CommandContext): ArchiveLimits {
  const profile = (context.capabilities?.commandLimits as { archive?: ArchiveCommandsOptions["limits"] } | undefined)?.archive;
  if (!profile) return configured;
  settings({ limits: profile });
  const limits = { ...configured };
  for (const key of Object.keys(profile) as (keyof ArchiveLimits)[]) {
    if (profile[key] !== undefined) limits[key] = Math.min(limits[key], profile[key]);
  }
  return Object.freeze(limits);
}

export function fail(message: string): never { throw new PublicDiagnostic(message); }

export function vfsPath(cwd: string, path: string): string {
  return path.startsWith("/") ? path : `${cwd === "/" ? "" : cwd}/${path}`;
}

export function wait<Value>(signal: AbortSignal, action: () => Value | PromiseLike<Value>): Promise<Value> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const unsubscribe = subscribeAbort(signal, () => reject(signal.reason));
    try {
      Promise.resolve(action()).then(value => {
        unsubscribe();
        resolve(value);
      }, error => { unsubscribe(); reject(error); });
    } catch (error) { unsubscribe(); reject(error); }
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

const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function text(bytes: Uint8Array): string {
  try { return fatalUtf8Decoder.decode(bytes); }
  catch { return fail("invalid UTF-8 archive name or metadata"); }
}

export function checkPath(path: string, limits: ArchiveLimits): void {
  if (!path) fail("invalid empty, NUL, or non-Unicode path");
  let nonAscii = false;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c === 0) fail("invalid empty, NUL, or non-Unicode path");
    if (c >= 0x80) nonAscii = true;
  }
  if (nonAscii && new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytesFrom(path)) !== path) fail("invalid empty, NUL, or non-Unicode path");
  const byteLen = nonAscii ? utf8ByteLength(path) : path.length;
  if (byteLen > limits.maxPathBytes) fail("path byte limit exceeded");
  if (limits.maxDepth !== Infinity && path.split("/").length > limits.maxDepth + 1) fail("path depth limit exceeded");
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
    if (this.members % 128 === 0) {
      await yieldTurn(this.context.signal);
    }
  }
  async output(value: string | Uint8Array, stderr = false): Promise<void> {
    const bytes = typeof value === "string" ? bytesFrom(value) : bytesFrom(value);
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
    // Empty views can still retain a large backing slab; downstream memory
    // admission must see them before the producer advances.
    if (chunk.length <= chunkSize) {
      signal.throwIfAborted();
      yield chunk;
    } else {
      for (let offset = 0; offset < chunk.length; offset += chunkSize) {
        signal.throwIfAborted();
        yield chunk.subarray(offset, Math.min(chunk.length, offset + chunkSize));
      }
    }
    if (++turns % 128 === 0) {
      await yieldTurn(signal);
    }
  }
}

export async function* fileSource(context: CommandContext, path: string, limits: ArchiveLimits): ByteSource {
  context.signal.throwIfAborted();
  yield* readBytes(readFileStream(context.fs, path, { signal: context.signal, chunkSize: limits.chunkSize }), context.signal);
}

export async function publish(context: CommandContext, path: string, source: ByteSource, mode = 0o600): Promise<void> {
  const capabilities = await operation(context, () => context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities);
  context.signal.throwIfAborted();
  const options = { signal: context.signal, flag: "wx" as const, ...(capabilities.permissions === false ? {} : { mode }) };
  if (context.fs.writeStream && capabilities.streamingWrite !== false) {
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
  return collectBytes(fileSource(context, path, limits), { signal: context.signal, ...(Number.isFinite(limits.maxFilesFromBytes) ? { maxBytes: limits.maxFilesFromBytes } : {})});
}
