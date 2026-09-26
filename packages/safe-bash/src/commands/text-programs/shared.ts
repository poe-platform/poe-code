import { publicDiagnosticMessage } from "../../diagnostics.js";
import { writeDiagnostic } from "../../escaping.js";
import { Budget, ProgramError } from "safe-bash-regex-engine/text/budget";
export { Budget, ProgramError, type TextProgramOptions } from "safe-bash-regex-engine/text/budget";
import { FsError, readBytes, writeBytes, type ByteSource, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { RESOLVED_EXIT_ONE, RESOLVED_EXIT_ZERO } from "../internal.js";
import { inputRequirements } from "../portable-requirements.js";
import { requiredFileInput } from "../search/requirements.js";

export function byteString(text: string): string {
  const len = text.length;
  for (let i = 0; i < len; i++) {
    if (text.charCodeAt(i) >= 0x80) return Buffer.from(text, "utf8").toString("latin1");
  }
  return text;
}
export function bytes(text: string): Uint8Array { return Buffer.from(text, "latin1"); }
const sharedSmallWriteBuf = new Uint8Array(256);
const RESOLVED_VOID_SYNC: Promise<void> = (() => {
  const p = Promise.resolve();
  (p as unknown as Record<symbol, boolean>)[Symbol.for("safe-bash.syncResolved")] = true;
  return p;
})();

export function virtualPath(context: CommandContext, path: string): string {
  if (!path) throw new FsError("ENOENT", { path });
  if (path.includes("\0")) throw new FsError("EINVAL", { path });
  return path.startsWith("/") ? path : `${context.cwd.replace(/\/$/u, "")}/${path}`;
}

export function write(context: CommandContext, text: string): Promise<void> {
  context.signal.throwIfAborted();
  const len = text.length;
  if (len <= 256) {
    const stdoutSink = context.stdout as { isPipeStage?: boolean; writeRangeSync?: (src: Uint8Array, len: number) => boolean };
    if (!stdoutSink.isPipeStage && typeof stdoutSink.writeRangeSync === "function") {
      for (let i = 0; i < len; i++) {
        sharedSmallWriteBuf[i] = text.charCodeAt(i) & 0xff;
      }
      if (stdoutSink.writeRangeSync(sharedSmallWriteBuf, len) !== false) {
        return RESOLVED_VOID_SYNC;
      }
    }
  }
  return writeBytes(context.stdout, bytes(text), context.signal);
}

export function input(context: CommandContext, file = "-"): ByteSource {
  context.signal.throwIfAborted();
  if (file === "-" || file === "/dev/stdin") return readBytes(context.stdin, context.signal);
  return requiredFileInput(context, inputRequirements, "file", file, Infinity);
}

export async function readProgram(context: CommandContext, file: string): Promise<string> {
  const contents = await context.fs.readFile(virtualPath(context, file), { signal: context.signal });
  return Buffer.from(contents).toString("latin1");
}

export interface RecordLine { readonly text: string; readonly terminated: boolean; readonly file: string; readonly fileIndex: number }

export async function* lineRecords(context: CommandContext, files: readonly string[], budget: Budget): AsyncGenerator<RecordLine> {
  const names = files.length ? files : ["-"];
  for (let fileIndex = 0; fileIndex < names.length; fileIndex++) {
    const file = names[fileIndex]!;
    let pending = "";
    for await (const chunk of input(context, file)) {
      budget.step();
      const text = Buffer.from(chunk).toString("latin1");
      let start = 0;
      let end: number;
      while ((end = text.indexOf("\n", start)) >= 0) {
        yield { text: budget.check(pending + text.slice(start, end)), terminated: true, file, fileIndex };
        pending = ""; start = end + 1;
      }
      pending = budget.check(pending + text.slice(start));
    }
    if (pending) yield { text: pending, terminated: false, file, fileIndex };
  }
}

export interface LineRecordBatch {
  readonly text: string;
  readonly firstLinePrefix: string;
  readonly ends: ArrayLike<number>;
  readonly trailingText: string | undefined;
  readonly file: string;
  readonly fileIndex: number;
}

const EMPTY_ENDS = new Int32Array(0);
let sharedBatchEnds = new Int32Array(4096);

export interface CachedLatin1Batch {
  readonly byteLength: number;
  readonly b0: number;
  readonly bMid: number;
  readonly bEnd: number;
  readonly text: string;
  readonly ends: Int32Array;
  readonly maxLineLen: number;
  readonly lastLineStart: number;
}

const latin1BatchCache = new WeakMap<Uint8Array, CachedLatin1Batch>();
let lastLatin1Batch: CachedLatin1Batch | undefined;

function matchesLatin1Bytes(chunk: Uint8Array, text: string): boolean {
  for (let index = 0; index < chunk.byteLength; index++) {
    if (chunk[index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

export function getCachedLatin1Batch(chunk: Uint8Array): CachedLatin1Batch | undefined {
  const cLen = chunk.byteLength;
  if (cLen < 256) return undefined;
  let cached = latin1BatchCache.get(chunk);
  const fromWeakMap = cached !== undefined;
  if (!cached && lastLatin1Batch !== undefined && lastLatin1Batch.byteLength === cLen) {
    cached = lastLatin1Batch;
  }
  if (
    !cached ||
    cached.byteLength !== cLen ||
    cached.b0 !== chunk[0] ||
    cached.bMid !== chunk[cLen >> 1] ||
    cached.bEnd !== chunk[cLen - 1] ||
    !matchesLatin1Bytes(chunk, cached.text)
  ) {
    const cText = Buffer.isBuffer(chunk) ? chunk.toString("latin1") : Buffer.from(chunk.buffer, chunk.byteOffset, cLen).toString("latin1");
    let cStart = 0;
    let cEnd: number;
    let cEndsCount = 0;
    let maxLineLen = 0;
    while ((cEnd = cText.indexOf("\n", cStart)) >= 0) {
      const lLen = cEnd - cStart;
      if (lLen > maxLineLen) maxLineLen = lLen;
      if (cEndsCount === sharedBatchEnds.length) {
        const grown = new Int32Array(sharedBatchEnds.length * 2);
        grown.set(sharedBatchEnds);
        sharedBatchEnds = grown;
      }
      sharedBatchEnds[cEndsCount++] = cEnd;
      cStart = cEnd + 1;
    }
    const tailLen = cText.length - cStart;
    if (tailLen > maxLineLen) maxLineLen = tailLen;
    const ends = cEndsCount > 0 ? sharedBatchEnds.slice(0, cEndsCount) : EMPTY_ENDS;
    cached = {
      byteLength: cLen,
      b0: chunk[0]!,
      bMid: chunk[cLen >> 1]!,
      bEnd: chunk[cLen - 1]!,
      text: cText,
      ends,
      maxLineLen,
      lastLineStart: cStart,
    };
    latin1BatchCache.set(chunk, cached);
    lastLatin1Batch = cached;
  }
  return cached;
}

export function getCachedLatin1Text(chunk: Uint8Array): string {
  const cached = getCachedLatin1Batch(chunk);
  if (cached) return cached.text;
  return Buffer.isBuffer(chunk)
    ? chunk.toString("latin1")
    : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString("latin1");
}

export async function* lineRecordBatches(context: CommandContext, files: readonly string[], budget: Budget): AsyncGenerator<LineRecordBatch> {
  const names = files.length ? files : ["-"];
  for (let fileIndex = 0; fileIndex < names.length; fileIndex++) {
    const file = names[fileIndex]!;
    let pending = "";
    const iter = input(context, file)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
      tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
    };
    let done = false;
    try {
    while (true) {
      const syncRes = typeof iter.tryNextSync === "function" ? iter.tryNextSync() : undefined;
      const res = syncRes ?? await iter.next();
      if (res.done) { done = true; break; }
      const chunk = res.value;
      budget.step();
      const cLen = chunk.byteLength;
      if (pending === "" && cLen >= 256) {
        const cached = getCachedLatin1Batch(chunk)!;
        if (cached.maxLineLen > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
        if (cached.lastLineStart === cached.text.length) {
          if (cached.ends.length > 0) {
            yield { text: cached.text, firstLinePrefix: "", ends: cached.ends, trailingText: undefined, file, fileIndex };
          }
          continue;
        }
      }
      const text = Buffer.isBuffer(chunk) ? chunk.toString("latin1") : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString("latin1");
      let start = 0;
      let end: number;
      let endsCount = 0;
      let firstLinePrefix = "";
      while ((end = text.indexOf("\n", start)) >= 0) {
        const len = (endsCount === 0 ? pending.length : 0) + (end - start);
        if (len > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
        if (endsCount === 0 && pending) {
          firstLinePrefix = pending;
          pending = "";
        }
        if (endsCount === sharedBatchEnds.length) {
          const grown = new Int32Array(sharedBatchEnds.length * 2);
          grown.set(sharedBatchEnds);
          sharedBatchEnds = grown;
        }
        sharedBatchEnds[endsCount++] = end;
        start = end + 1;
      }
      if (start < text.length) {
        pending = budget.check(pending ? pending + text.slice(start) : text.slice(start));
      }
      if (endsCount > 0) {
        yield { text, firstLinePrefix, ends: sharedBatchEnds.slice(0, endsCount), trailingText: undefined, file, fileIndex };
      }
    }
    } finally {
      if (!done) await iter.return?.();
    }
    if (pending) {
      yield { text: "", firstLinePrefix: "", ends: EMPTY_ENDS, trailingText: pending, file, fileIndex };
    }
  }
}

export function command(name: string, run: (context: CommandContext) => number | Promise<number>): CommandDefinition {
  return {
    name,
    execute(context) {
      context.signal.throwIfAborted();
      try {
        const res = run(context);
        if (typeof res === "number") {
          return res === 0 ? RESOLVED_EXIT_ZERO : res === 1 ? RESOLVED_EXIT_ONE : Promise.resolve({ exitCode: res });
        }
        return res.then(
          exitCode => ({ exitCode }),
          async error => {
            context.signal.throwIfAborted();
            await writeDiagnostic(context.stderr, `${name}: ${publicDiagnosticMessage(error, context.onInternalError)}\n`, context.signal);
            return { exitCode: error instanceof ProgramError ? 2 : 1 };
          },
        );
      } catch (error) {
        return (async () => {
          context.signal.throwIfAborted();
          await writeDiagnostic(context.stderr, `${name}: ${publicDiagnosticMessage(error, context.onInternalError)}\n`, context.signal);
          return { exitCode: error instanceof ProgramError ? 2 : 1 };
        })();
      }
    },
  };
}
