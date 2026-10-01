import { latin1Bytes as bytes, latin1Text } from "../../byte-encoding.js";
export { bytes };
const textEncoder = new TextEncoder();
import { publicDiagnosticMessage } from "safe-bash-contracts/diagnostics";
import { writeDiagnostic } from "safe-bash-contracts/escaping";
import { Budget, ProgramError } from "safe-bash-regex-engine/text/budget";
export { Budget, ProgramError, type TextProgramOptions } from "safe-bash-regex-engine/text/budget";
import { FsError, readBytes, writeBytes, type ByteSource, type CommandContext, type CommandDefinition } from "safe-bash-contracts";
import { builtInDirectContextExecutors, RESOLVED_EXIT_ONE, RESOLVED_EXIT_ZERO } from "../../internal.js";
import { inputRequirements } from "../../portable-requirements.js";
import { requiredFileInput } from "../search/requirements.js";

export function byteString(text: string): string {
  const len = text.length;
  for (let i = 0; i < len; i++) {
    if (text.charCodeAt(i) >= 0x80) return latin1Text(textEncoder.encode(text));
  }
  return text;
}
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
  const stdoutSink = context.stdout as {
    isPipeStage?: boolean;
    writeSync?: (chunk: Uint8Array) => boolean;
    writeRangeSync?: (src: Uint8Array, len: number) => boolean;
  };
  if (!stdoutSink.isPipeStage) {
    if (len <= 256 && typeof stdoutSink.writeRangeSync === "function") {
      const buffer = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        buffer[i] = text.charCodeAt(i) & 0xff;
      }
      if (stdoutSink.writeRangeSync(buffer, len) !== false) {
        return RESOLVED_VOID_SYNC;
      }
    } else if (typeof stdoutSink.writeSync === "function") {
      if (stdoutSink.writeSync(bytes(text)) !== false) {
        return RESOLVED_VOID_SYNC;
      }
    }
  }
  return writeBytes(context.stdout, bytes(text), context.signal);
}

export function input(context: CommandContext, file = "-"): ByteSource {
  context.signal.throwIfAborted();
  if (file === "-" || file === "/dev/stdin") return readBytes(context.stdin, context.signal);
  return requiredFileInput(context, inputRequirements, "file", file, context.inputBudget?.maxBytes ?? Infinity);
}

export async function readProgram(context: CommandContext, file: string): Promise<string> {
  const contents = await context.fs.readFile(virtualPath(context, file), { signal: context.signal });
  return latin1Text(contents);
}

export interface RecordLine { readonly text: string; readonly terminated: boolean; readonly file: string; readonly fileIndex: number }

export async function* lineRecords(context: CommandContext, files: readonly string[], budget: Budget): AsyncGenerator<RecordLine> {
  const names = files.length ? files : ["-"];
  for (let fileIndex = 0; fileIndex < names.length; fileIndex++) {
    const file = names[fileIndex]!;
    let pending = "";
    for await (const chunk of input(context, file)) {
      budget.step();
      const text = latin1Text(chunk);
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

export interface CachedLatin1Batch {
  readonly byteLength: number;
  readonly b0: number;
  readonly bMid: number;
  readonly bEnd: number;
  readonly rawBuf: Uint8Array;
  readonly text: string;
  readonly ends: Int32Array;
  readonly maxLineLen: number;
  readonly lastLineStart: number;
}

export function getCachedLatin1Batch(chunk: Uint8Array): CachedLatin1Batch | undefined {
  const cLen = chunk.byteLength;
  if (cLen < 256) return undefined;
  let batchEnds = new Int32Array(4096);
  const rawBuf = new Uint8Array(chunk);
  const cText = latin1Text(rawBuf);
  let cStart = 0;
  let cEnd: number;
  let cEndsCount = 0;
  let maxLineLen = 0;
  while ((cEnd = cText.indexOf("\n", cStart)) >= 0) {
    const lLen = cEnd - cStart;
    if (lLen > maxLineLen) maxLineLen = lLen;
    if (cEndsCount === batchEnds.length) {
      const grown = new Int32Array(batchEnds.length * 2);
      grown.set(batchEnds);
      batchEnds = grown;
    }
    batchEnds[cEndsCount++] = cEnd;
    cStart = cEnd + 1;
  }
  const tailLen = cText.length - cStart;
  if (tailLen > maxLineLen) maxLineLen = tailLen;
  const ends = cEndsCount > 0 ? batchEnds.slice(0, cEndsCount) : EMPTY_ENDS;
  return {
    byteLength: cLen,
    b0: chunk[0]!,
    bMid: chunk[cLen >> 1]!,
    bEnd: chunk[cLen - 1]!,
    rawBuf,
    text: cText,
    ends,
    maxLineLen,
    lastLineStart: cStart,
  };
}

export function getCachedLatin1Text(chunk: Uint8Array): string {
  const cached = getCachedLatin1Batch(chunk);
  if (cached) return cached.text;
  return latin1Text(chunk);
}

export async function* lineRecordBatches(context: CommandContext, files: readonly string[], budget: Budget): AsyncGenerator<LineRecordBatch> {
  let batchEnds = new Int32Array(4096);
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
      const text = latin1Text(chunk);
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
        if (endsCount === batchEnds.length) {
          const grown = new Int32Array(batchEnds.length * 2);
          grown.set(batchEnds);
          batchEnds = grown;
        }
        batchEnds[endsCount++] = end;
        start = end + 1;
      }
      if (start < text.length) {
        pending = budget.check(pending ? pending + text.slice(start) : text.slice(start));
      }
      if (endsCount > 0) {
        yield { text, firstLinePrefix, ends: batchEnds.slice(0, endsCount), trailingText: undefined, file, fileIndex };
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

function handleCommandError(name: string, context: CommandContext, error: unknown): Promise<{ exitCode: number }> {
  return (async () => {
    context.signal.throwIfAborted();
    await writeDiagnostic(context.stderr, `${name}: ${publicDiagnosticMessage(error, context.onInternalError)}\n`, context.signal);
    return { exitCode: error instanceof ProgramError ? 2 : 1 };
  })();
}

function finishCommandAsync(name: string, context: CommandContext, res: Promise<number>): Promise<{ exitCode: number }> {
  return res.then(
    exitCode => ({ exitCode }),
    error => handleCommandError(name, context, error),
  );
}

export function command(name: string, run: (context: CommandContext) => number | Promise<number>): CommandDefinition {
  const definition: CommandDefinition = {
    name,
    execute(context) {
      context.signal.throwIfAborted();
      try {
        const res = run(context);
        if (typeof res === "number") {
          return res === 0 ? RESOLVED_EXIT_ZERO : res === 1 ? RESOLVED_EXIT_ONE : Promise.resolve({ exitCode: res });
        }
        return finishCommandAsync(name, context, res);
      } catch (error) {
        return handleCommandError(name, context, error);
      }
    },
  };
  builtInDirectContextExecutors.add(definition.execute);
  return definition;
}
