import { tryReadMemoryFileViewSync } from "@poe-code/safe-fs/core";
import { assertCommandRequirements } from "../../contracts/command-requirements.js";
import { FsError, toByteSource, type ByteSource, type CommandDefinition } from "../../contracts/index.js";
import { hasYieldCheckpoint } from "../../contracts/yield.js";
import { getRuntimeBackingFileSystem } from "../../fs/creation-mask.js";
import { bufferLimit as internalBufferLimit, diagnostic, encoder, input, integer, lines, options as parseOptions, output, pathOf, UsageError, value, type Line } from "../internal.js";
import { RecordBuffer } from "../record-buffer.js";
import { RegexExecutor, RegexExecutionError, withRegexSession } from "../regex-execution/portable.js";
import { inProcessRegexProviders, reusableBatchRows, trustedInputRows, type GrepDescriptor } from "../regex-execution/protocol.js";
import { prepareErgonomicRegex, type ErgonomicVmMatcher } from "./ergonomic-regex.js";
import { SearchError } from "./options.js";
import { grepRequirements, requiredFileInput } from "./requirements.js";
import { grepFiles } from "./grep-files.js";

export interface GrepLimits {
  readonly maxPatterns?: number | undefined;
  readonly maxPatternBytes?: number | undefined;
  readonly maxLineBytes?: number | undefined;
  readonly maxContextBytes?: number | undefined;
  readonly maxFileBytes?: number | undefined;
  readonly ergonomicRegex?: boolean;
}


interface GrepLine extends Line {
  readonly all: boolean;
  chunk?: Uint8Array;
  start?: number;
  searchEnd?: number;
}
class PooledGrepLine implements GrepLine {
  chunk!: Uint8Array;
  start = 0;
  searchEnd = 0;
  all = false;
  terminated = true;
  private _bytes: Uint8Array | undefined;
  reset(chunk: Uint8Array, start: number, searchEnd: number, all: boolean, terminated: boolean): this {
    this.chunk = chunk;
    this.start = start;
    this.searchEnd = searchEnd;
    this.all = all;
    this.terminated = terminated;
    this._bytes = undefined;
    return this;
  }
  get bytes(): Uint8Array {
    return this._bytes ??= this.chunk.subarray(this.start, this.searchEnd);
  }
}
const grepLinePool: PooledGrepLine[] = Array.from({ length: 128 }, () => new PooledGrepLine());
const grepBatchSlices: GrepLine[][] = Array.from({ length: 129 }, (_, k) => {
  const arr = grepLinePool.slice(0, k);
  trustedInputRows.add(arr);
  reusableBatchRows.add(arr);
  return arr;
});
const EMPTY_GREP_ROWS: readonly GrepLine[] = Object.freeze([]);
trustedInputRows.add(EMPTY_GREP_ROWS);
const sharedGrepOutBuffer = new Uint8Array(64 * 1024);
let sharedGrepOutInUse = false;
const syncResolved = Symbol.for("safe-bash.syncResolved");
function isSyncResolved(promise: unknown): boolean {
  return Boolean(promise && typeof promise === "object" && (promise as Record<symbol, unknown>)[syncResolved]);
}
const NEWLINE_BYTES = new Uint8Array([10]);
const NUL_BYTES = new Uint8Array([0]);
const SINGLE_STDIN_FILE: readonly { name: string; nested: boolean }[] = Object.freeze([Object.freeze({ name: "-", nested: false })]);
const GREP_LONG_OPTIONS: Readonly<Record<string, string | false>> = Object.freeze({
  color: "color:", colour: "color:", "binary-files": "binary-files:", binary: false,
  label: "label:", "initial-tab": "T", "group-separator": "group-separator:", help: false,
  "basic-regexp": "G", "extended-regexp": "E", "fixed-strings": "F", "perl-regexp": "P", "ignore-case": "i",
  "invert-match": "v", "line-number": "n", count: "c", "files-with-matches": "l",
  "files-without-match": "L", quiet: "q", silent: "q", "no-filename": "h", "with-filename": "H",
  "only-matching": "o", "word-regexp": "w", "line-regexp": "x", regexp: "e", file: "f",
  "max-count": "m", "no-messages": "s", text: "a", "null-data": "z", "after-context": "A",
  "before-context": "B", context: "C", "byte-offset": "b", null: "Z", recursive: "r",
  "dereference-recursive": "R", directories: "d", devices: "D", "line-buffered": false,
  "no-group-separator": false, "no-ignore-case": false, include: "include:", exclude: "exclude:",
  "exclude-from": "exclude-from:", "exclude-dir": "exclude-dir:",
});

async function forEachGrepLineBatch(
  source: ByteSource,
  separator: number,
  maxLineBytes: number,
  maxRecords: () => number,
  all = false,
  onBatch: (batch: GrepLine[], endOfChunk: boolean) => Promise<boolean> | boolean,
): Promise<void> {
  const lineLimit = Math.min(internalBufferLimit, maxLineBytes);
  let pending: RecordBuffer | undefined;
  let fallbackBatch: GrepLine[] | undefined;
  let poolCount = 0;
  let bytes = 0;
  const iter = source[Symbol.asyncIterator]() as AsyncIterator<Uint8Array> & {
    tryNextSync?: () => IteratorResult<Uint8Array> | undefined;
    syncReturn?: () => void;
  };
  const canTrySync = typeof iter.tryNextSync === "function";
  let done = false;
  try {
    while (true) {
      let step = canTrySync ? iter.tryNextSync!() : undefined;
      if (step === undefined) step = await iter.next();
      if (step.done) {
        done = true;
        break;
      }
      const chunk = step.value;
      let start = 0;
      while (start < chunk.length) {
        const end = chunk.indexOf(separator, start);
        if (end < 0) break;
        let lineLen: number;
        const maxRec = maxRecords();
        if ((!pending || pending.size === 0) && !fallbackBatch && poolCount < 128 && maxRec <= 128) {
          const tailLength = end - start;
          if (tailLength > lineLimit) {
            throw new FsError("EFBIG", { message: "line buffer limit exceeded" });
          }
          lineLen = tailLength;
          grepLinePool[poolCount++]!.reset(chunk, start, end, all, true);
        } else {
          if (!fallbackBatch) {
            fallbackBatch = [];
            trustedInputRows.add(fallbackBatch);
            reusableBatchRows.add(fallbackBatch);
            for (let i = 0; i < poolCount; i++) fallbackBatch.push(grepLinePool[i]!);
            poolCount = 0;
          }
          let line: GrepLine;
          if (!pending || pending.size === 0) {
            const tailLength = end - start;
            if (tailLength > lineLimit) {
              throw new FsError("EFBIG", { message: "line buffer limit exceeded" });
            }
            lineLen = tailLength;
            line = fallbackBatch.length < 128
              ? grepLinePool[fallbackBatch.length]!.reset(chunk, start, end, all, true)
              : { bytes: chunk.subarray(start, end), all, terminated: true };
          } else {
            const finished = pending.finish(undefined, chunk, start, end);
            lineLen = finished.length;
            line = {
              bytes: finished,
              all,
              terminated: true,
            };
          }
          fallbackBatch.push(line);
        }
        start = end + 1;
        bytes += lineLen;
        const next = chunk.indexOf(separator, start);
        const currentCount = fallbackBatch ? fallbackBatch.length : poolCount;
        if (
          currentCount >= maxRec ||
          bytes >= 64 * 1024 ||
          next < 0 ||
          bytes + next - start > 64 * 1024 ||
          next - start > maxLineBytes
        ) {
          const activeBatch = fallbackBatch ?? grepBatchSlices[poolCount]!;
          const cont = onBatch(activeBatch, next < 0);
          const keepGoing = cont instanceof Promise ? await cont : cont;
          if (fallbackBatch) fallbackBatch.length = 0;
          else poolCount = 0;
          bytes = 0;
          if (!keepGoing) return;
        }
      }
      if (start < chunk.length) {
        (pending ??= new RecordBuffer(lineLimit)).append(chunk, start);
      }
    }
    if (pending && pending.size) {
      if (!fallbackBatch) {
        fallbackBatch = [];
        trustedInputRows.add(fallbackBatch);
        reusableBatchRows.add(fallbackBatch);
        for (let i = 0; i < poolCount; i++) fallbackBatch.push(grepLinePool[i]!);
        poolCount = 0;
      }
      fallbackBatch.push({ bytes: pending.finish(), all, terminated: false });
    }
    const finalBatch = fallbackBatch && fallbackBatch.length > 0
      ? fallbackBatch
      : poolCount > 0 ? grepBatchSlices[poolCount]! : undefined;
    if (finalBatch) {
      const cont = onBatch(finalBatch, true);
      if (cont instanceof Promise) await cont;
    }
  } finally {
    if (!done) {
      if (typeof iter.syncReturn === "function") iter.syncReturn();
      else await iter.return?.();
    }
    pending?.clear();
  }
}

function isSimpleAsciiLiteralChar(c: number): boolean {
  if (c < 32 || c > 126) return false;
  switch (c) {
    case 36: // $
    case 40: // (
    case 41: // )
    case 42: // *
    case 43: // +
    case 46: // .
    case 63: // ?
    case 91: // [
    case 92: // \
    case 93: // ]
    case 94: // ^
    case 123: // {
    case 124: // |
    case 125: // }
      return false;
    default:
      return true;
  }
}

async function tryFastGrepAscii(
  context: Parameters<CommandDefinition["execute"]>[0],
  limits: GrepLimits,
  pat: string,
  fileArg: string | undefined,
  anchoredStart: boolean,
): Promise<{ exitCode: number }> {
  const literalStart = anchoredStart ? 1 : 0;
  const litLen = pat.length - literalStart;
  const firstByte = pat.charCodeAt(literalStart);
  const ownsSharedOut = !sharedGrepOutInUse;
  if (ownsSharedOut) sharedGrepOutInUse = true;
  const outBuffer = ownsSharedOut ? sharedGrepOutBuffer : new Uint8Array(64 * 1024);
  let outUsed = 0;
  let anySelected = false;
  const flush = (): Promise<void> | undefined => {
    if (!outUsed) return;
    const bytes = outBuffer.slice(0, outUsed);
    outUsed = 0;
    const pending = output(context, bytes);
    return isSyncResolved(pending) ? undefined : pending;
  };
  try {
    if (fileArg !== undefined && fileArg !== "-") {
      const path = pathOf(context, fileArg);
      const backing = getRuntimeBackingFileSystem(context.fs);
      if (
        backing !== undefined &&
        backing.capabilitiesFor === undefined &&
        path !== "/dev" &&
        !path.startsWith("/dev/") &&
        context.fs.capabilities.streamingRead !== false &&
        context.fs.capabilities.read !== false &&
        Object.getPrototypeOf(backing)?.constructor?.name === "MemoryFileSystem" &&
        !Object.prototype.hasOwnProperty.call(backing, "readStream") &&
        !Object.prototype.hasOwnProperty.call(backing, "readFile")
      ) {
        assertCommandRequirements(context, grepRequirements, ["file"]);
        const maxFileBytes = Number.isFinite(limits.maxFileBytes) ? limits.maxFileBytes : undefined;
        const raw = tryReadMemoryFileViewSync(backing, path, maxFileBytes, context.signal);
        if (raw !== undefined) {
          const lineLimit = Math.min(internalBufferLimit, limits.maxLineBytes ?? Infinity);
          let lineStart = 0;
          while (lineStart < raw.length) {
            context.signal.throwIfAborted();
            let lineEnd = raw.indexOf(10, lineStart);
            if (lineEnd < 0) lineEnd = raw.length;
            const lineLen = lineEnd - lineStart;
            if (lineLen > lineLimit) {
              throw new FsError("EFBIG", { message: "line buffer limit exceeded" });
            }
            const maxPos = lineEnd - litLen;
            let matched = false;
            if (anchoredStart) {
              if (lineStart <= maxPos && raw[lineStart] === firstByte) {
                let equal = true;
                for (let offset = 1; equal && offset < litLen; offset++) {
                  equal = raw[lineStart + offset] === pat.charCodeAt(literalStart + offset);
                }
                matched = equal;
              }
            } else {
              let pos = lineStart;
              while (pos <= maxPos) {
                const index = raw.indexOf(firstByte, pos);
                if (index < 0 || index > maxPos) break;
                let equal = true;
                for (let offset = 1; equal && offset < litLen; offset++) {
                  equal = raw[index + offset] === pat.charCodeAt(literalStart + offset);
                }
                if (equal) {
                  matched = true;
                  break;
                }
                pos = index + 1;
              }
            }
            if (matched) {
              anySelected = true;
              if (outUsed + lineLen + 1 > outBuffer.length) {
                const pending = flush();
                if (pending) await pending;
              }
              if (lineLen + 1 > outBuffer.length) {
                await output(context, raw.subarray(lineStart, lineEnd));
                await output(context, NEWLINE_BYTES);
              } else {
                for (let i = lineStart; i < lineEnd; i++) {
                  outBuffer[outUsed++] = raw[i]!;
                }
                outBuffer[outUsed++] = 10;
                if (outUsed >= 32768) {
                  const pending = flush();
                  if (pending) await pending;
                }
              }
            }
            lineStart = lineEnd + 1;
          }
          const pending = flush();
          if (pending) await pending;
          return { exitCode: anySelected ? 0 : 1 };
        }
      }
    }
    const source = fileArg === undefined || fileArg === "-"
      ? input(context)
      : requiredFileInput(context, grepRequirements, "file", fileArg, limits.maxFileBytes ?? Infinity);
    await forEachGrepLineBatch(source, 10, limits.maxLineBytes ?? Infinity, () => 128, false, async (batch, endOfChunk) => {
      for (let bIdx = 0; bIdx < batch.length; bIdx++) {
        context.signal.throwIfAborted();
        const line = batch[bIdx]!;
        const chunk = line.chunk ?? line.bytes;
        const lStart = line.chunk !== undefined ? line.start! : 0;
        const lEnd = line.chunk !== undefined ? line.searchEnd! : chunk.length;
        const lineLen = lEnd - lStart;
        const maxPos = lEnd - litLen;
        let matched = false;
        if (anchoredStart) {
          if (lStart <= maxPos && chunk[lStart] === firstByte) {
            let equal = true;
            for (let offset = 1; equal && offset < litLen; offset++) {
              equal = chunk[lStart + offset] === pat.charCodeAt(literalStart + offset);
            }
            matched = equal;
          }
        } else {
          let pos = lStart;
          while (pos <= maxPos) {
            const index = chunk.indexOf(firstByte, pos);
            if (index < 0 || index > maxPos) break;
            let equal = true;
            for (let offset = 1; equal && offset < litLen; offset++) {
              equal = chunk[index + offset] === pat.charCodeAt(literalStart + offset);
            }
            if (equal) { matched = true; break; }
            pos = index + 1;
          }
        }
        if (!matched) continue;
        anySelected = true;
        if (outUsed + lineLen + 1 > outBuffer.length) {
          const pending = flush();
          if (pending) await pending;
        }
        if (lineLen + 1 > outBuffer.length) {
          await output(context, chunk.subarray(lStart, lEnd));
          await output(context, NEWLINE_BYTES);
        } else {
          for (let i = lStart; i < lEnd; i++) {
            outBuffer[outUsed++] = chunk[i]!;
          }
          outBuffer[outUsed++] = 10;
        }
      }
      if (endOfChunk || outUsed >= 8192) {
        const pending = flush();
        if (pending) await pending;
      }
      return true;
    });
    const pending = flush();
    if (pending) await pending;
    return { exitCode: anySelected ? 0 : 1 };
  } catch (error) {
    const pending = flush();
    if (pending) await pending;
    context.signal.throwIfAborted();
    if (error instanceof RegexExecutionError) throw error;
    await diagnostic(context, error);
    return { exitCode: 2 };
  } finally {
    if (ownsSharedOut) sharedGrepOutInUse = false;
  }
}
async function executeGrepWithSession(
  context: Parameters<CommandDefinition["execute"]>[0],
  session: Parameters<Parameters<typeof withRegexSession>[2]>[0],
  limits: GrepLimits,
  maxPatternCount: number,
  bufferLimit: number,
): Promise<{ exitCode: number }> {
    try {
      let afterContext = 0;
      let beforeContext = 0;
      let fileSelection: "l" | "L" | undefined;
      let filenameOption: "h" | "H" | undefined;
      let matcher: "G" | "E" | "F" | "P" | undefined;
      let helpRequested = false;
      let ignoreCase = false;
      const binaryFiles: { mode: "text" | "without-match" | "binary" } = { mode: "text" };
      let directoriesAction: string | undefined;
      const filters: { key: string; pattern: string }[] = [];
      let normalizedArgs: readonly string[] = context.args;
      for (let i = 0; i < context.args.length; i++) {
        const arg = context.args[i]!;
        if (arg === "--") break;
        if (arg.length > 1 && arg.charCodeAt(0) === 45 && arg.charCodeAt(1) >= 48 && arg.charCodeAt(1) <= 57 && /^-[0-9]+$/u.test(arg)) {
          const copy = context.args.slice();
          let optionsEnded = false;
          for (let j = i; j < copy.length; j++) {
            const item = copy[j]!;
            if (!optionsEnded && item === "--") { optionsEnded = true; continue; }
            if (!optionsEnded && /^-[0-9]+$/u.test(item)) copy[j] = `-C${item.slice(1)}`;
          }
          normalizedArgs = copy;
          break;
        }
      }
      const parsed = parseOptions(normalizedArgs, "GEFPivnclLqhHowxae:f:m:szA:B:C:bZrRd:D:IT", GREP_LONG_OPTIONS, false, undefined, (key, index, offset) => {
        const text = normalizedArgs[index]!.slice(offset);
        if (["include", "exclude", "exclude-from"].includes(key)) filters.push({ key, pattern: text });
        if (key === "d") directoriesAction = text;
        if (key === "binary-files") {
          if (text !== "text" && text !== "without-match" && text !== "binary") throw new UsageError(`unsupported binary-files mode '${text}'; use text`);
          binaryFiles.mode = text;
        }
        if (!["A", "B", "C"].includes(key)) return;
        try {
          const length = integer(text);
          if (key === "A" || key === "C") afterContext = length;
          if (key === "B" || key === "C") beforeContext = length;
        }
        catch { throw new UsageError(`${text}: invalid context length argument`); }
      }, key => {
        if (key === "help") helpRequested = true;
        if (!helpRequested && (key === "G" || key === "E" || key === "F" || key === "P")) {
          if (matcher !== undefined && matcher !== key) throw new UsageError("conflicting matchers specified");
          matcher = key;
        }
        if (key === "l" || key === "L") fileSelection = key;
        if (key === "h" || key === "H") filenameOption = key;
        if (key === "i") ignoreCase = true;
        if (key === "no-ignore-case") ignoreCase = false;
        if (key === "I") binaryFiles.mode = "without-match";
        if (key === "a") binaryFiles.mode = "text";
        if (key === "r" || key === "R") directoriesAction = "recurse";
      });
      if (fileSelection) parsed.flags.delete(fileSelection === "l" ? "L" : "l");
      if (filenameOption) parsed.flags.delete(filenameOption === "h" ? "H" : "h");
      if (parsed.flags.has("help")) {
        await output(context, `Usage: grep [OPTION]... PATTERN [FILE]...
Print lines matching PATTERN. With no FILE, or FILE -, read standard input.

  -G, --basic-regexp       Use basic regular expressions (default)
  -E, --extended-regexp    Use extended regular expressions
  -F, --fixed-strings      Use fixed strings
  -e, --regexp=PATTERN     Add a pattern (repeatable)
  -f, --file=FILE          Read patterns from FILE
  -i, --ignore-case        Ignore case distinctions
  -v, --invert-match       Select nonmatching lines
  -w, --word-regexp        Match whole words
  -x, --line-regexp        Match whole lines
  -n, --line-number        Print line numbers
  -H, --with-filename      Print filenames
  -h, --no-filename        Suppress filenames
  -o, --only-matching      Print only matching parts
  -c, --count              Print matching line counts
  -l, --files-with-matches Print filenames with matches
  -L, --files-without-match Print filenames without matches
  -q, --quiet, --silent    Suppress normal output
  -m, --max-count=NUM      Stop after NUM selected lines per file
  -A, --after-context=NUM  Print NUM lines after selected lines
  -B, --before-context=NUM Print NUM lines before selected lines
  -C, --context=NUM        Print NUM lines before and after selected lines
  -s, --no-messages        Suppress file error messages
  -a, --text               Process input as text
  -z, --null-data          Use NUL-delimited records
  -b, --byte-offset        Print byte offsets (match offsets with -o)
  -Z, --null               Follow printed filenames with NUL
  -r, --recursive          Search directories recursively
  -R, --dereference-recursive Follow links during recursive search
  -d, --directories=ACTION Read, skip or recurse into directories
  -D, --devices=ACTION     Read or skip special files
      --include=GLOB      Search matching basenames
      --exclude=GLOB      Skip matching basenames
      --exclude-dir=GLOB  Skip matching directories
      --exclude-from=FILE Read exclusion globs from FILE
      --no-group-separator Suppress separators between context groups
      --no-ignore-case    Use case-sensitive matching
      --line-buffered     Accepted; output writes are already awaited
      --color=WHEN, --colour=WHEN Accept never or auto for non-terminal output
      --binary-files=text Treat input as text within regex executor limits
      --binary            Preserve bytes (no Windows text-mode translation)
      --label=LABEL       Name standard input in filename prefixes
      --initial-tab       Insert a tab after line prefixes
      --group-separator=SEP Use SEP between context groups
      --help              Display this help and exit
      --                  End options

Exit status: 0 when a line is selected, 1 when none is selected, 2 on error.
Regular expression support depends on the configured regex executor.
The default bounded matcher rejects BRE groups, intervals, backreferences and escape extensions.
Use extended alternation: grep -E 'Remove upvote|Upvoted'
For literal alternatives: grep -F -e 'Remove upvote' -e 'Upvoted'
If an action succeeded but filtering failed, retry only the read-only verification;
inspect the resulting state before repeating the action.
`);
        return { exitCode: 0 };
      }
      let positionalPattern: string | undefined;
      const color = value(parsed, "color");
      if (color !== undefined && color !== "never" && color !== "auto") throw new UsageError(`unsupported color mode '${color}'; use never or auto (non-terminal output)`);
      if (!parsed.flags.has("e") && !parsed.flags.has("f")) {
        if (!parsed.operands.length) throw new UsageError("missing pattern");
        positionalPattern = parsed.operands.shift()!;
      }
      const multipleFiles = parsed.operands.length > 1;
      const patternFiles = parsed.values.get("f") ?? [];
      const patterns: string[] = [];
      let patternCount = 0;
      let patternBytes = 0;
      const admit = (chunk: string | Uint8Array, atStart: boolean): boolean => {
        context.signal.throwIfAborted();
        const size = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
        if (size > bufferLimit - patternBytes) throw new UsageError(`pattern byte limit exceeded (${bufferLimit} bytes)`);
        patternBytes += size;
        for (let offset = 0; offset < chunk.length;) {
          if (atStart && ++patternCount > maxPatternCount) throw new UsageError(`pattern count limit exceeded (${maxPatternCount})`);
          const newline = typeof chunk === "string" ? chunk.indexOf("\n", offset) : chunk.indexOf(10, offset);
          if (newline < 0) return false;
          offset = newline + 1;
          atStart = true;
        }
        return atStart;
      };
      const addArgument = (pattern: string) => {
        admit(pattern, true);
        if (pattern !== "") {
          let ascii = true;
          for (let i = 0; i < pattern.length; i++) {
            if (pattern.charCodeAt(i) >= 128) { ascii = false; break; }
          }
          const latin1 = ascii ? pattern : Buffer.from(pattern, "utf8").toString("latin1");
          let start = 0;
          while (start < latin1.length) {
            const newline = latin1.indexOf("\n", start);
            if (newline < 0) {
              patterns.push(start === 0 ? latin1 : latin1.slice(start));
              break;
            }
            patterns.push(latin1.slice(start, newline));
            start = newline + 1;
          }
        }
        if (pattern === "" || pattern.endsWith("\n")) {
          if (++patternCount > maxPatternCount) throw new UsageError(`pattern count limit exceeded (${maxPatternCount})`);
          patterns.push("");
        }
      };
      async function* admitted(source: ByteSource): ByteSource {
        let atStart = true;
        for await (const chunk of source) {
          atStart = admit(chunk, atStart);
          yield chunk;
        }
      }
      const ePatterns = parsed.values.get("e");
      if (ePatterns) for (const pattern of ePatterns) addArgument(pattern);
      for (const name of patternFiles) {
        const source = name === "-" ? input(context) : requiredFileInput(context, grepRequirements, "pattern-file", name, bufferLimit - patternBytes);
        for await (const line of lines(admitted(source))) patterns.push(Buffer.from(line.bytes).toString("latin1"));
      }
      if (positionalPattern !== undefined) addArgument(positionalPattern);
      let vmMatcher: ErgonomicVmMatcher | undefined;
      let effectivePatterns = patterns;
      let effectiveExtended = parsed.flags.has("E") || parsed.flags.has("P");
      if ((limits.ergonomicRegex || parsed.flags.has("P")) && !parsed.flags.has("F")) {
        try {
          const prepared = prepareErgonomicRegex(patterns, {
            kind: "grep",
            fixed: false,
            extended: effectiveExtended,
            caseMode: ignoreCase ? "insensitive" : "sensitive",
            whole: parsed.flags.has("x"),
            word: parsed.flags.has("w"),
            nullData: parsed.flags.has("z"),
          });
          if (prepared.mode === "vm") {
            vmMatcher = prepared.vm;
            effectivePatterns = [];
          } else {
            effectivePatterns = [...prepared.patterns];
            effectiveExtended = prepared.extended;
          }
        } catch (err) {
          if (err instanceof SearchError) throw new UsageError(err.message);
          throw err;
        }
      }
      const descriptor: GrepDescriptor = {
        kind: "grep", patterns: effectivePatterns, fixed: parsed.flags.has("F"), extended: effectiveExtended,
        insensitive: ignoreCase, whole: parsed.flags.has("x"), word: parsed.flags.has("w"),
      };
      const initRes = session.runSync(descriptor, EMPTY_GREP_ROWS);
      if (initRes instanceof Promise) await initRes;
      const runGrepBatch = (batch: GrepLine[]) => vmMatcher ? vmMatcher.batchSync(batch) : session.runSync(descriptor, batch);
      const maxCount = value(parsed, "m") === undefined ? Infinity : integer(value(parsed, "m")!);
      const batchSize = Number.isFinite(maxCount) || parsed.flags.has("q") || parsed.flags.has("l") || parsed.flags.has("L") ? 1 : 128;
      const delimiter = parsed.flags.has("z") ? "\0" : "\n";
      const delimiterBytes = parsed.flags.has("z") ? NUL_BYTES : NEWLINE_BYTES;
      const lineBuffered = parsed.flags.has("line-buffered") || parsed.flags.has("o");
      const ownsSharedOut = !sharedGrepOutInUse;
      if (ownsSharedOut) sharedGrepOutInUse = true;
      let outBuffer: Uint8Array | undefined;
      let outStart = 0;
      let outUsed = 0;
      const flushOutSyncOrAsync = (): Promise<void> | undefined => {
        if (!outBuffer || outUsed === outStart) return undefined;
        const view = outBuffer.subarray(outStart, outUsed);
        const p = output(context, view);
        if (isSyncResolved(p)) {
          outStart = 0;
          outUsed = 0;
          return undefined;
        }
        outStart = outUsed;
        return p.then(() => {
          if (outStart === outUsed) {
            outStart = 0;
            outUsed = 0;
          }
        });
      };
      const flushOut = async () => {
        const p = flushOutSyncOrAsync();
        if (p) await p;
      };
      const writeOut = async (chunk: string | Uint8Array) => {
        const bytes = typeof chunk === "string" ? (chunk.length === 0 ? undefined : encoder.encode(chunk)) : (chunk.length === 0 ? undefined : chunk);
        if (!bytes) return;
        if (lineBuffered || parsed.flags.has("o") || bytes.length > 16 * 1024) {
          await flushOut();
          await output(context, bytes);
          return;
        }
        outBuffer ??= ownsSharedOut ? sharedGrepOutBuffer : new Uint8Array(64 * 1024);
        if (outUsed + bytes.length > outBuffer.length) {
          await flushOut();
          outBuffer = new Uint8Array(64 * 1024);
          outStart = 0;
          outUsed = 0;
        }
        outBuffer.set(bytes, outUsed);
        outUsed += bytes.length;
      };
      try {
      const extractMatches = parsed.flags.has("o") && !["c", "q", "l", "L", "v"].some(flag => parsed.flags.has(flag));
      const displayLines = !["c", "q", "l", "L"].some(flag => parsed.flags.has(flag));
      const withContext = (beforeContext > 0 || afterContext > 0) && displayLines && !(parsed.flags.has("o") && parsed.flags.has("v"));
      const before = withContext ? beforeContext : 0;
      const after = withContext ? afterContext : 0;
      let emittedGroup = false;
      let anySelected = false;
      let failed = false;
      const targets = (parsed.operands.length === 0 && directoriesAction === undefined && !parsed.flags.has("r") && !parsed.flags.has("R") && !parsed.values.has("d") && !parsed.values.has("D") && filters.length === 0)
        ? SINGLE_STDIN_FILE
        : grepFiles(context, parsed, filters, () => { failed = true; }, directoriesAction);
      for await (const { name, nested } of targets) {
        let count = 0;
        let number = 0;
        let byteOffset = 0;
        let nextOffset = 0;
        let lastCovered = 0;
        let remainingAfter = 0;
        let pendingBytes = 0;
        const pending = withContext ? new Map<number, Line & { offset: number }>() : undefined;
        const named = name === "-" ? value(parsed, "label") ?? "(standard input)" : name;
        const hasLinePrefix = (!parsed.flags.has("h") && (parsed.flags.has("H") || multipleFiles || nested)) || parsed.flags.has("n") || parsed.flags.has("b");
        const delimiterByte = delimiterBytes[0]!;
        const prefix = (lineNumber = false, position = number, separator = ":", offset = byteOffset) => `${!parsed.flags.has("h") && (parsed.flags.has("H") || multipleFiles || nested) ? `${named}${parsed.flags.has("Z") ? "\0" : separator}` : ""}${lineNumber && parsed.flags.has("n") ? `${position}${separator}` : ""}${lineNumber && parsed.flags.has("b") ? `${offset}${separator}` : ""}${lineNumber && parsed.flags.has("T") && (parsed.flags.has("n") || parsed.flags.has("b") || !parsed.flags.has("h") && (parsed.flags.has("H") || multipleFiles || nested)) ? "\t" : ""}`;
        const emitContext = async (line: Line, position: number, offset = byteOffset) => {
          if (!parsed.flags.has("o")) {
            await writeOut(prefix(true, position, "-", offset));
            await writeOut(line.bytes);
            await writeOut(delimiterBytes);
          }
          lastCovered = position;
        };
        try {
          const source = name === "-" ? input(context) : requiredFileInput(context, grepRequirements, "file", name, limits.maxFileBytes ?? Infinity);
          let earlyExitZero = false;
          const invertMatch = parsed.flags.has("v");
          const isQuiet = parsed.flags.has("q");
          const isListFiles = parsed.flags.has("l") || parsed.flags.has("L");
          const isCountOnly = parsed.flags.has("c");
          const isOnlyMatching = parsed.flags.has("o");
          const canFastBufferLines = !isQuiet && !isListFiles && !isCountOnly && !withContext && !isOnlyMatching && !hasLinePrefix && !lineBuffered && binaryFiles.mode !== "without-match";
          const processBatchSlow = async (batch: GrepLine[], endOfChunk: boolean, resultsPromise?: Promise<readonly (readonly { start: number; end: number }[])[]>, startIdx = 0, precomputedResults?: readonly (readonly { start: number; end: number }[])[]): Promise<boolean> => {
            const results = precomputedResults ?? await resultsPromise!;
            for (let index = startIdx; index < batch.length; index++) {
              const line = batch[index]!;
              context.signal.throwIfAborted();
              number++;
              byteOffset = nextOffset;
              const curLineLen = line.searchEnd !== undefined ? line.searchEnd - line.start! : line.bytes.length;
              nextOffset += curLineLen + (line.terminated ? 1 : 0);
              const found = results[index]!;
              const selected = count < maxCount && (found.length > 0) !== invertMatch;
              if (!selected) {
                if (remainingAfter > 0) {
                  await emitContext(line, number);
                  remainingAfter--;
                  if (count >= maxCount && remainingAfter === 0) return false;
                } else if (before > 0) {
                  if (pending!.size >= before) {
                    const oldest = pending!.keys().next().value!;
                    pendingBytes -= pending!.get(oldest)!.bytes.length + 1;
                    pending!.delete(oldest);
                  }
                  const size = line.bytes.length + 1;
                  if (size > (limits.maxContextBytes ?? Infinity) - pendingBytes) throw new UsageError(`context byte limit exceeded (${limits.maxContextBytes} bytes)`);
                  pending!.set(number, { bytes: Uint8Array.from(line.bytes), terminated: line.terminated, offset: byteOffset });
                  pendingBytes += size;
                }
                continue;
              }
              count++;
              anySelected = true;
              if (isQuiet) { earlyExitZero = true; return false; }
              if (isListFiles) return false;
              if (!isCountOnly) {
                if (withContext) {
                  const first = pending!.keys().next().value ?? number;
                  if (!parsed.flags.has("no-group-separator") && emittedGroup && (lastCovered === 0 || first > lastCovered + 1)) await writeOut((value(parsed, "group-separator") ?? "--") + delimiter);
                  for (const [position, previous] of pending!) await emitContext(previous, position, previous.offset);
                  pending!.clear();
                  pendingBytes = 0;
                  remainingAfter = after;
                  lastCovered = number;
                  emittedGroup = true;
                }
                if (isOnlyMatching) {
                  if (!invertMatch) {
                    let end = -1;
                    for (const match of found) {
                      if (match.start === match.end || match.start < end) continue;
                      await writeOut(prefix(true, number, ":", byteOffset + match.start));
                      await writeOut(line.bytes.subarray(match.start, match.end));
                      await writeOut(delimiterBytes);
                      end = match.end;
                    }
                  }
                } else {
                  if (!hasLinePrefix && !lineBuffered && line.chunk !== undefined && line.start !== undefined && line.searchEnd !== undefined) {
                    const lStart = line.start;
                    const lEnd = line.searchEnd;
                    const lLen = lEnd - lStart;
                    outBuffer ??= ownsSharedOut ? sharedGrepOutBuffer : new Uint8Array(64 * 1024);
                    if (outUsed + lLen + 1 <= outBuffer.length) {
                      const c = line.chunk;
                      let dst = outUsed;
                      for (let i = lStart; i < lEnd; i++) outBuffer[dst++] = c[i]!;
                      outBuffer[dst++] = delimiterByte;
                      outUsed = dst;
                      if (count >= maxCount && remainingAfter === 0) return false;
                      continue;
                    }
                  }
                  const p = hasLinePrefix ? prefix(true) : "";
                  if (p) await writeOut(p);
                  await writeOut(line.bytes);
                  await writeOut(delimiterBytes);
                }
              }
              if (count >= maxCount && remainingAfter === 0) return false;
            }
            if (endOfChunk || lineBuffered || outUsed - outStart >= 8192) await flushOut();
            return true;
          };
          if (maxCount > 0) await forEachGrepLineBatch(source, parsed.flags.has("z") ? 0 : 10, limits.maxLineBytes ?? Infinity, () => batchSize, extractMatches, (batch, endOfChunk) => {
            if (binaryFiles.mode === "without-match" && batch.some(line => line.bytes.includes(0))) {
              count = 0;
              return false;
            }
            const resOrPromise = runGrepBatch(batch);
            if (resOrPromise instanceof Promise || !canFastBufferLines) {
              return resOrPromise instanceof Promise
                ? processBatchSlow(batch, endOfChunk, resOrPromise)
                : processBatchSlow(batch, endOfChunk, undefined, 0, resOrPromise);
            }
            const results = resOrPromise;
            for (let index = 0; index < batch.length; index++) {
              const line = batch[index]!;
              context.signal.throwIfAborted();
              number++;
              byteOffset = nextOffset;
              const curLineLen = line.searchEnd !== undefined ? line.searchEnd - line.start! : line.bytes.length;
              nextOffset += curLineLen + (line.terminated ? 1 : 0);
              const found = results[index]!;
              const selected = count < maxCount && (found.length > 0) !== invertMatch;
              if (!selected) continue;
              if (line.chunk !== undefined && line.start !== undefined && line.searchEnd !== undefined) {
                const lStart = line.start;
                const lEnd = line.searchEnd;
                const lLen = lEnd - lStart;
                outBuffer ??= ownsSharedOut ? sharedGrepOutBuffer : new Uint8Array(64 * 1024);
                if (outUsed + lLen + 1 <= outBuffer.length) {
                  count++;
                  anySelected = true;
                  const c = line.chunk;
                  let dst = outUsed;
                  for (let i = lStart; i < lEnd; i++) outBuffer[dst++] = c[i]!;
                  outBuffer[dst++] = delimiterByte;
                  outUsed = dst;
                  if (count >= maxCount) return false;
                  continue;
                }
              }
              number--;
              nextOffset = byteOffset;
              return processBatchSlow(batch, endOfChunk, undefined, index, results);
            }
            if ((endOfChunk || outUsed - outStart >= 8192) && outUsed > outStart) {
              const p = flushOutSyncOrAsync();
              return p ? p.then(() => true) : true;
            }
            return true;
          });
          if (earlyExitZero) return { exitCode: 0 };
          const finalFlush = flushOutSyncOrAsync();
          if (finalFlush) await finalFlush;
          if (parsed.flags.has("q")) continue;
          if (parsed.flags.has("l") && count > 0 || parsed.flags.has("L") && count === 0) {
            await output(context, named + (parsed.flags.has("Z") ? "\0" : "\n"));
          } else if (parsed.flags.has("c") && !parsed.flags.has("l") && !parsed.flags.has("L")) await output(context, prefix() + count + delimiter);
        } catch (error) {
          await flushOut();
          context.signal.throwIfAborted();
          if (error instanceof RegexExecutionError) throw error;
          failed = true;
          if (!parsed.flags.has("s")) await diagnostic(context, error);
        }
      }
      return { exitCode: failed ? 2 : anySelected ? 0 : 1 };
      } finally {
        if (ownsSharedOut) sharedGrepOutInUse = false;
      }
    } catch (error) {
      context.signal.throwIfAborted();
      await diagnostic(context, error);
      return { exitCode: 2 };
    }
}

export function createGrepCommands(executor: RegexExecutor, limits: GrepLimits = {}): CommandDefinition[] {
  for (const [key, value] of Object.entries(limits)) {
    if (key === "ergonomicRegex") continue;
    if (value !== undefined && value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError("grep limits must be positive safe integers");
  }
  const maxPatternCount = limits.maxPatterns ?? Infinity;
  const bufferLimit = limits.maxPatternBytes ?? Infinity;
  const canFastAscii = limits.ergonomicRegex === true && inProcessRegexProviders.has(executor.provider);
  return [{
    name: "grep",
    filesystemRequirements: grepRequirements,
    execute: context => withRegexSession(context, executor, session => {
      const args = context.args;
      if (
        canFastAscii &&
        (args.length === 1 || args.length === 2) &&
        !hasYieldCheckpoint(context.signal) &&
        maxPatternCount >= 1
      ) {
        const pat = args[0]!;
        const fileArg = args[1];
        if (
          pat.length >= 1 &&
          pat.length <= 64 &&
          pat.length <= bufferLimit &&
          pat.charCodeAt(0) !== 45 &&
          (fileArg === undefined || fileArg === "-" || fileArg.charCodeAt(0) !== 45)
        ) {
          const anchoredStart = pat.length >= 2 && pat.charCodeAt(0) === 94;
          const literalStart = anchoredStart ? 1 : 0;
          let simpleAscii = true;
          for (let i = literalStart; i < pat.length; i++) {
            if (!isSimpleAsciiLiteralChar(pat.charCodeAt(i))) {
              simpleAscii = false;
              break;
            }
          }
          if (simpleAscii) {
            return tryFastGrepAscii(context, limits, pat, fileArg, anchoredStart);
          }
        }
      }
      return executeGrepWithSession(context, session, limits, maxPatternCount, bufferLimit);
    }),
  }];
}
