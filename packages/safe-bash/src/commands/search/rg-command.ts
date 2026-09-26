import { tryReadMemoryFileViewSync } from "@poe-code/safe-fs/core";
import { assertCommandRequirements, collectBytes, type ByteSource, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { hasYieldCheckpoint } from "../../contracts/yield.js";
import { chargeRuntimeFileSystemOperation, getRuntimeBackingFileSystem } from "../../fs/creation-mask.js";
import { Matcher, type Match } from "./matcher.js";
import { parse, ParsedArguments, SearchError, type Arguments, type SearchOptions } from "./options.js";
import { data, elapsed, Printer, stats, type Stats } from "./output.js";
import { diagnostic, Limits, lineBatches, trySyncLineBatches, OutputClosed, pathFor, type Line, type ReadState } from "./shared.js";
import { Walker, type FileTarget } from "./walk.js";
import { RegexExecutor, RegexExecutionError, withRegexSession } from "../regex-execution/portable.js";
import { inProcessRegexProviders } from "../regex-execution/protocol.js";
import { assertPathRequirements, requiredFileInput, searchRequirements } from "./requirements.js";
import { RESOLVED_EXIT_ONE, RESOLVED_EXIT_ZERO } from "../internal.js";

const EMPTY_RG_LINES: readonly Line[] = Object.freeze([]);
const EMPTY_PATTERNS: readonly string[] = Object.freeze([]);
const DEFAULT_CWD_PATHS: readonly string[] = Object.freeze(["."]);
const DEFAULT_STDIN_PATHS: readonly string[] = Object.freeze(["-"]);
const defaultLimitsTick = Limits.prototype.tick;
const sharedReadState: ReadState = { bytesRead: 0, bytesSearched: 0, binaryOffset: null, skipped: false };
const BATCH_SIZE_1: () => number = () => 1;
const BATCH_SIZE_128: () => number = () => 128;
const RETURN_TRUE = () => true;
const RETURN_FALSE = () => false;
function resolveToBoolean(promise: Promise<unknown>, found: boolean): Promise<boolean> {
  return promise.then(found ? RETURN_TRUE : RETURN_FALSE);
}

function trySearchFileSync(
  context: CommandContext,
  args: Arguments,
  limits: Limits,
  matcher: Matcher,
  printer: Printer,
  target: FileTarget,
  filename: boolean,
  totals: Stats,
  admittedBacking: ReturnType<typeof getRuntimeBackingFileSystem>,
): boolean | Promise<boolean | undefined> | undefined {
  if (Limits.prototype.tick !== defaultLimitsTick) return undefined;
  if (args.mode === "json" || matcher.crossLine) return undefined;
  const selectedOutput = !args.quiet && args.mode === "lines";
  if (selectedOutput || args.before > 0 || args.after > 0 || (target.entryName === undefined && target.path === "-")) return undefined;
  const hasCanonical = target._hasCanonical || Boolean(target.canonicalPath);
  const backing = hasCanonical ? admittedBacking : undefined;
  if (!hasCanonical || !backing) {
    return undefined;
  }
  const fastCharge = (context as { _chargeFastFsOp?: () => void })._chargeFastFsOp;
  if (fastCharge) fastCharge.call(context);
  else {
    context.signal.throwIfAborted();
    chargeRuntimeFileSystemOperation(context.fs);
  }
  const maxBytes = limits.hasFiniteMaxFileBytes ? limits.maxFileBytes : undefined;
  const view = target.memoryView ?? tryReadMemoryFileViewSync(backing, target.canonicalPath!, maxBytes, context.signal);
  if (view === undefined) return undefined;
  if (!args.hasInfiniteMaxCount && args.maxCount === 0) {
    totals.searches++;
    return false;
  }
  const binary = args.binary === "text" ? "text" : args.binary === "binary" || target.explicit ? "binary" : "skip";
  const needAll = args.replacement !== undefined || args.onlyMatching || args.mode === "matches" || args.stats === true;
  const hasExtYield = hasYieldCheckpoint(context.signal);
  const lit = matcher.literalAsciiBytes;
  if (
    lit !== undefined &&
    !args.invert &&
    args.replacement === undefined && !args.onlyMatching && args.mode !== "matches" &&
    !args.nullData &&
    !args.crlf &&
    binary === "skip" &&
    args.hasInfiniteMaxCount !== false &&
    !hasExtYield &&
    (view.length <= limits.maxLineBytesSmi || view.length <= limits.maxLineBytes) &&
    view.indexOf(0) === -1
  ) {
    const firstByte = lit[0]!;
    const litLen = lit.length;
    let matchedLines = 0;
    let matchesCount = 0;
    let bytesSearched = 0;
    if (
      !args.stats &&
      !limits.hasExtYield &&
      (args.mode === "count" || args.mode === "with" || args.mode === "without" || args.quiet) &&
      lit.indexOf(10) === -1
    ) {
      bytesSearched = view.length;
      const searchEnd = view.length - litLen;
      let pos = 0;
      while (pos <= searchEnd) {
        const index = view.indexOf(firstByte, pos);
        if (index < 0 || index > searchEnd) break;
        let equal = true;
        for (let offset = 1; offset < litLen; offset++) {
          if (view[index + offset] !== lit[offset]) { equal = false; break; }
        }
        if (equal) {
          matchedLines++;
          matchesCount++;
          if (args.quiet || args.mode === "with" || args.mode === "without") break;
          const nl = view.indexOf(10, index + litLen);
          if (nl < 0) break;
          pos = nl + 1;
        } else {
          pos = index + 1;
        }
      }
    } else {
      for (let start = 0; start < view.length;) {
        const newline = view.indexOf(10, start);
        const end = newline < 0 ? view.length : newline;
        bytesSearched = newline < 0 ? end : end + 1;
        const pending = limits.tick();
        if (pending) return pending.then(() => undefined);
        let count = 0;
        let pos = start;
        while (pos <= end - litLen) {
          const index = view.indexOf(firstByte, pos);
          if (index < 0 || index > end - litLen) break;
          let equal = true;
          for (let offset = 1; offset < litLen; offset++) {
            if (view[index + offset] !== lit[offset]) { equal = false; break; }
          }
          if (equal) count++;
          pos = index + (equal ? litLen : 1);
        }
        if (count) {
          matchedLines++;
          matchesCount += count;
          if (!args.stats && (args.quiet || args.mode === "with" || args.mode === "without")) break;
        }
        start = bytesSearched;
      }
    }
    const matched = matchedLines > 0;
    const found = args.mode === "without" ? !matched : matched;
    totals.searches++;
    if (matched) totals.searches_with_match++;
    totals.bytes_searched += bytesSearched;
    totals.matched_lines += matchedLines;
    totals.matches += matchesCount;
    if (!args.quiet) {
      if ((args.mode === "with" || args.mode === "without") && found) {
        const p = target.entryName !== undefined && target._label === undefined
          ? printer.filenamePartsSyncOrAsync(target.dirLabel!, target.entryName)
          : printer.filenameSyncOrAsync(target.label);
        if (p) return resolveToBoolean(p, found);
      }
      if (args.mode === "count" && (matched || args.includeZero)) {
        const p = target.entryName !== undefined && target._label === undefined
          ? printer.countPartsSyncOrAsync(target.dirLabel!, target.entryName, matchedLines, filename)
          : printer.countSyncOrAsync(target.label, matchedLines, filename);
        if (p) return resolveToBoolean(p, found);
      }
    }
    return found;
  }
  sharedReadState.bytesRead = 0;
  sharedReadState.bytesSearched = 0;
  sharedReadState.binaryOffset = null;
  sharedReadState.skipped = false;
  const batchSizeFn = Number.isFinite(args.maxCount) || args.quiet || args.mode === "with" || args.mode === "without" ? BATCH_SIZE_1 : BATCH_SIZE_128;
  const syncBatches = trySyncLineBatches(view, limits, sharedReadState, binary, args.nullData, batchSizeFn, needAll, args.crlf);
  if (syncBatches === undefined) return undefined;
  const maxCountSmi = Number.isFinite(args.maxCount) ? (args.maxCount | 0) : 0x3fffffff;
  let pendingTick: Promise<void> | undefined;
  let matchedLines = 0;
  let matchesCount = 0;
  let lastSelectedEnd = 0;
  let bytesSearched = sharedReadState.bytesSearched | 0;
  records: for (let bIdx = 0; bIdx < syncBatches.length; bIdx++) {
    const batch = syncBatches[bIdx]!;
    const batchRes = matcher.batchSync(batch);
    if (batchRes instanceof Promise) {
      return (pendingTick ? Promise.all([pendingTick, batchRes]) : batchRes).then(() => undefined);
    }
    for (let index = 0; index < batch.length; index++) {
      const line = batch[index]!;
      bytesSearched = line.offset + line.rawLength;
      const t = limits.tick();
      if (t !== undefined) {
        if (hasExtYield) return t.then(() => undefined);
        pendingTick ??= t;
      }
      const matches = batchRes[index]!;
      const selected = (matches.length > 0) !== args.invert;
      if (selected) lastSelectedEnd = line.offset + line.rawLength;
      if (selected && matchedLines < maxCountSmi) {
        matchedLines++;
        matchesCount += args.invert ? 0 : matches.length;
        if (!args.stats && (args.quiet || args.mode === "with" || args.mode === "without")) break records;
      }
      if (matchedLines >= maxCountSmi) {
        bytesSearched = Math.max(lastSelectedEnd, args.invert || line.rawLength === line.content.length ? line.offset : 0);
        break records;
      }
    }
  }
  sharedReadState.bytesSearched = bytesSearched;
  const matched = matchedLines > 0;
  const found = args.mode === "without" ? !matched && !sharedReadState.skipped : matched;
  totals.searches++;
  if (matched) totals.searches_with_match++;
  totals.bytes_searched += sharedReadState.bytesSearched;
  totals.matched_lines += matchedLines;
  totals.matches += matchesCount;
  if (!args.quiet) {
    if ((args.mode === "with" || args.mode === "without") && found) {
      const p = target.entryName !== undefined && target._label === undefined
        ? printer.filenamePartsSyncOrAsync(target.dirLabel!, target.entryName)
        : printer.filenameSyncOrAsync(target.label);
      if (p) return resolveToBoolean(pendingTick ? Promise.all([pendingTick, p]) : p, found);
    }
    if ((args.mode === "count" || args.mode === "matches") && (matched || args.includeZero) && !sharedReadState.skipped) {
      const amount = !args.invert && (args.mode === "matches" || args.onlyMatching) ? matchesCount : matchedLines;
      const p = target.entryName !== undefined && target._label === undefined
        ? printer.countPartsSyncOrAsync(target.dirLabel!, target.entryName, amount, filename)
        : printer.countSyncOrAsync(target.label, amount, filename);
      if (p) return resolveToBoolean(pendingTick ? Promise.all([pendingTick, p]) : p, found);
    }
  }
  return pendingTick ? resolveToBoolean(pendingTick, found) : found;
}

interface InputSelection { readonly paths: readonly string[]; readonly implicit: boolean }

function selectInput(context: CommandContext, args: Arguments, options: SearchOptions): InputSelection {
  if (args.paths.length) return { paths: args.paths, implicit: false };
  if (args.mode === "files" || options.defaultInput === "cwd" || args.patternFiles.includes("-")) return { paths: ["."], implicit: true };
  const stdin = options.defaultInput === "stdin" || context.stdinIsDefault === false;
  return { paths: stdin ? ["-"] : ["."], implicit: !stdin };
}

async function patterns(context: CommandContext, args: Arguments, limits: Limits): Promise<string[]> {
  const patterns = [...args.patterns];
  for (const file of args.patternFiles) {
    if (file !== "-") await assertPathRequirements(context, searchRequirements, ["pattern-file"], [file]);
    const bytes = file === "-" ? await collectBytes(context.stdin, { maxBytes: limits.maxPatternBytes, signal: context.signal })
      : await context.fs.readFile(pathFor(context, file), { signal: context.signal, ...(Number.isFinite(limits.maxPatternBytes) ? { maxBytes: limits.maxPatternBytes } : {}) });
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new SearchError(`pattern file '${file}' is not UTF-8`); }
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    for (const line of lines) patterns.push(line.endsWith("\r") ? line.slice(0, -1) : line);
  }
  let bytes = 0;
  for (const pattern of patterns) {
    bytes += Buffer.byteLength(pattern);
    if (bytes > limits.maxPatternBytes) throw new SearchError("pattern byte limit exceeded");
  }
  return patterns;
}

async function searchFile(context: CommandContext, args: Arguments, limits: Limits, matcher: Matcher, printer: Printer, target: FileTarget, stdin: ByteSource, filename: boolean): Promise<{ found: boolean; stats: Stats }> {
  const totals = stats(); totals.searches = 1;
  if (!args.hasInfiniteMaxCount && args.maxCount === 0) return { found: false, stats: totals };
  const state: ReadState = { bytesRead: 0, bytesSearched: 0, binaryOffset: null, skipped: false };
  const binary = args.binary === "text" ? "text" : args.binary === "binary" || target.explicit ? "binary" : "skip";
  let source: ByteSource | Uint8Array = target.path === "-"
    ? stdin
    : requiredFileInput(context, searchRequirements, "file", target.path, limits.maxFileBytes);
  let crossLineMatches: Match[] | undefined;
  if (matcher.crossLine) {
    const rawBytes = source instanceof Uint8Array
      ? source
      : await collectBytes(source, { maxBytes: limits.maxFileBytes, signal: context.signal });
    source = rawBytes;
    crossLineMatches = matcher.matchBuffer(rawBytes, true);
    if (args.onlyMatching && !args.invert && args.mode === "lines") {
      state.bytesRead = rawBytes.length;
      state.bytesSearched = rawBytes.length;
      const selectedOutput = !args.quiet;
      const fileOutputStart = limits.outputBytes;
      let lastMatchedLine = 0;
      for (const m of crossLineMatches) {
        let lineNum = 1;
        let lineStart = 0;
        for (let i = 0; i < m.start; i++) {
          if (rawBytes[i] === 10) { lineNum++; lineStart = i + 1; }
        }
        if (totals.matched_lines >= args.maxCount && lineNum > lastMatchedLine) break;
        let endLine = lineNum;
        for (let i = m.start; i < m.end - 1; i++) if (rawBytes[i] === 10) endLine++;
        totals.matched_lines += Math.max(0, endLine - Math.max(lastMatchedLine + 1, lineNum) + 1);
        lastMatchedLine = endLine;
        totals.matches++;
        if (args.quiet && !args.stats) break;
        if (selectedOutput) {
          const rawBuf = Buffer.from(rawBytes);
          const syntheticLine: Line = {
            number: lineNum,
            offset: lineStart,
            rawBytes: rawBuf.subarray(m.start, m.end),
            rawLength: m.end - m.start,
            content: rawBuf,
            bytes: rawBuf,
            all: true,
            terminated: true,
          };
          await printer.record(target.label, syntheticLine, [{ start: m.start, end: m.end }], true, filename);
        }
      }
      if (limits.outPos > 0) await limits.flush();
      const matched = totals.matched_lines > 0;
      totals.searches_with_match = matched ? 1 : 0;
      totals.bytes_searched = state.bytesSearched;
      totals.bytes_printed = limits.outputBytes - fileOutputStart;
      return { found: matched, stats: totals };
    }
  }
  let before: { line: Line; matches: Match[] }[] | undefined;
  let beforeBytes = 0;
  let lastPrinted = 0;
  let after = 0;
  let begun = false;
  let binaryPrinted = false;
  let lastSelectedEnd = 0;
  let fileOutputStart = limits.outputBytes;
  const begin = async () => {
    if (begun) return;
    begun = true; fileOutputStart = limits.outputBytes;
    if (args.mode === "json") await printer.event("begin", { path: data(Buffer.from(target.label)) });
  };
  const selectedOutput = !args.quiet && (args.mode === "lines" || args.mode === "json");
  const binaryOutput = selectedOutput && args.mode === "lines" && binary === "binary";
  const needAll = args.replacement !== undefined || args.onlyMatching || args.mode === "json" || args.mode === "matches" || args.stats === true;
  const batchSize = () => Number.isFinite(args.maxCount) || args.quiet && args.mode !== "json" || args.mode === "with" || args.mode === "without" || binaryOutput && state.binaryOffset !== null ? 1 : 128;
  const syncBatches = source instanceof Uint8Array ? trySyncLineBatches(source, limits, state, binary, args.nullData, batchSize, needAll, args.crlf) : undefined;
  let syncIdx = 0;
  let asyncIter: AsyncIterator<Line[]> | undefined;
  let failure: { reason: unknown } | undefined;
  try {
  records: while (true) {
    let batch: Line[];
    if (syncBatches !== undefined) {
      if (syncIdx >= syncBatches.length) break;
      batch = syncBatches[syncIdx++]!;
    } else {
      asyncIter ??= lineBatches(source, limits, state, binary, args.nullData, batchSize, needAll, args.crlf)[Symbol.asyncIterator]();
      const next = await asyncIter.next();
      if (next.done) { asyncIter = undefined; break; }
      batch = next.value;
    }
    const batchRes = crossLineMatches !== undefined
      ? batch.map(line => {
          const lineStart = line.offset;
          const lineEnd = line.offset + line.content.length;
          const lineMatches: Match[] = [];
          for (const m of crossLineMatches!) {
            if (m.end > m.start ? (m.start <= lineEnd && m.end > lineStart) : (m.start >= lineStart && m.start <= lineEnd)) {
              lineMatches.push({
                start: Math.max(0, m.start - lineStart),
                end: Math.min(line.content.length, m.end - lineStart),
              });
            }
          }
          return lineMatches;
        })
      : matcher.batchSync(batch);
    const results = batchRes instanceof Promise ? await batchRes : batchRes;
    for (let index = 0; index < batch.length; index++) {
      const line = batch[index]!;
      state.bytesSearched = line.offset + line.rawLength;
      const tickPending = limits.tick();
      if (tickPending) await tickPending;
      if (binaryOutput && state.binaryOffset !== null && totals.matched_lines > 0) {
        await printer.binary(target.label, state.binaryOffset, filename); binaryPrinted = true; break records;
      }
      const matches = results[index]!;
      // A multiline match can be projected onto several records for printing.
      // Count its occurrence only in the record containing its original start.
      const matchCount = crossLineMatches === undefined ? matches.length : crossLineMatches.reduce((count, match) =>
        count + Number(match.start >= line.offset && match.start <= line.offset + line.content.length), 0);
      const limitedInvertedTail = args.invert && totals.matched_lines >= args.maxCount && after > 0 && line.rawLength === line.content.length;
      const selected = (matches.length > 0) !== args.invert || limitedInvertedTail;
      if (selected) lastSelectedEnd = line.offset + line.rawLength;
      if (selected && totals.matched_lines < args.maxCount) {
        totals.matched_lines++; totals.matches += args.invert ? 0 : matchCount;
        if (!args.stats && (args.quiet && args.mode !== "json" || args.mode === "with" || args.mode === "without")) break records;
        if (selectedOutput) {
          await begin();
          if (state.binaryOffset !== null && args.mode !== "json") {
            if (!binaryPrinted) { await printer.binary(target.label, state.binaryOffset, filename); binaryPrinted = true; }
            break records;
          }
          if (before) for (const previous of before) if (previous.line.number > lastPrinted) {
            await printer.record(target.label, previous.line, previous.matches, false, filename); lastPrinted = previous.line.number;
          }
          await printer.record(target.label, line, args.invert ? [] : matches, true, filename); lastPrinted = line.number;
          after = args.after;
        }
      } else if (after && selectedOutput) {
        if (selected) { totals.matched_lines++; totals.matches += args.invert && !limitedInvertedTail ? 0 : matchCount; }
        await printer.record(target.label, line, matches, selected, filename); lastPrinted = line.number; after--;
      }
      if (binaryOutput && args.before > 0 && state.binaryOffset !== null) break records;
      if (totals.matched_lines >= args.maxCount && (!selectedOutput || after === 0)) {
        state.bytesSearched = Math.max(lastSelectedEnd, args.invert || line.rawLength === line.content.length ? line.offset : 0);
        break records;
      }
      if (args.before > 0) {
        before ??= [];
        before.push({ line, matches }); beforeBytes += line.rawLength;
        while (before.length > args.before) beforeBytes -= before.shift()!.line.rawLength;
        if (beforeBytes > limits.maxFileBytes) throw new SearchError("context buffer byte limit exceeded");
      }
    }
    if (syncBatches === undefined && limits.outPos > 0) await limits.flush();
  }
  } catch (error) {
    failure = { reason: error };
  }
  try { await asyncIter?.return?.(); }
  catch (error) { if (!failure) throw error; }
  if (failure) throw failure.reason;
  if (binaryOutput && state.binaryOffset !== null && totals.matched_lines > 0 && !binaryPrinted) {
    await printer.binary(target.label, state.binaryOffset, filename);
  }
  const matched = totals.matched_lines > 0;
  const found = args.mode === "without" ? !matched && !state.skipped : matched;
  totals.searches_with_match = matched ? 1 : 0;
  totals.bytes_searched = state.bytesSearched;
  if (selectedOutput) totals.bytes_printed = limits.outputBytes - fileOutputStart;
  if (!args.quiet) {
    if ((args.mode === "with" || args.mode === "without") && found) await printer.filename(target.label);
    if ((args.mode === "count" || args.mode === "matches") && (matched || args.includeZero) && !state.skipped) {
      const amount = !args.invert && (args.mode === "matches" || args.onlyMatching) ? totals.matches : totals.matched_lines;
      await printer.count(target.label, amount, filename);
    }
    if (begun && args.mode === "json") {
      await printer.event("end", { path: data(Buffer.from(target.label)), binary_offset: state.binaryOffset, stats: totals });
    }
  }
  return { found, stats: totals };
}

// Module initialization and pooled cleanup cannot allocate request-scoped host resources.
const DUMMY_SIGNAL = Object.freeze({
  aborted: false,
  reason: undefined,
  onabort: null,
  throwIfAborted(): void {},
  addEventListener(): void {},
  removeEventListener(): void {},
  dispatchEvent(): boolean { return true; },
}) as unknown as AbortSignal;
const DUMMY_CONTEXT: CommandContext = {
  stdin: { async *[Symbol.asyncIterator]() {} },
  stdout: { async write() {} },
  stderr: { async write() {} },
  fs: {} as CommandContext["fs"],
  cwd: "/",
  env: {},
  args: [],
  command: "rg",
  signal: DUMMY_SIGNAL,
};
const DUMMY_SESSION = {} as import("../regex-execution/portable.js").RegexSession;
const DUMMY_REPORT = async () => {};

class PooledRgFastRunner {
  inUse = false;
  readonly args = new ParsedArguments();
  readonly limits = new Limits(DUMMY_CONTEXT, {});
  readonly matcher = new Matcher(EMPTY_PATTERNS, this.args, DUMMY_SESSION, true, true);
  readonly walker = new Walker(DUMMY_CONTEXT, this.args, this.limits, DUMMY_REPORT, DUMMY_SESSION);
  readonly printer = new Printer(this.args, this.limits);
  readonly totals: Stats = stats();
  context: CommandContext = DUMMY_CONTEXT;
  fastReadBacking: ReturnType<typeof getRuntimeBackingFileSystem> = undefined;
  found = false;
  abortedToSlow = false;
  readonly boundOnTarget = (target: FileTarget): boolean => {
    const args = this.args;
    if (args.mode === "files") {
      this.found = true;
      if (!args.quiet) {
        const fRes = target.entryName !== undefined && target._label === undefined
          ? this.printer.filenamePartsSyncOrAsync(target.dirLabel!, target.entryName)
          : this.printer.filenameSyncOrAsync(target.label);
        if (fRes) {
          this.abortedToSlow = true;
          return false;
        }
        return true;
      }
      return false;
    }
    const showFilename = args.filename ?? target.recursive;
    const syncOut = trySearchFileSync(this.context, args, this.limits, this.matcher, this.printer, target, showFilename, this.totals, this.fastReadBacking);
    if (typeof syncOut === "boolean") {
      this.found ||= syncOut;
      if (!args.stats && args.quiet && this.found && args.mode !== "json") return false;
      return true;
    }
    this.abortedToSlow = true;
    return false;
  };
}

let pooledRgFastRunner: PooledRgFastRunner | undefined;

function tryExecuteRgFastSync(
  context: CommandContext,
  executor: RegexExecutor,
  options: SearchOptions,
): Promise< import("../../contracts/index.js").CommandResult > | undefined {
  if (Limits.prototype.tick !== defaultLimitsTick || hasYieldCheckpoint(context.signal)) return undefined;
  const fastMem = (context as { _fastMemoryBackingFs?: NonNullable<ReturnType<typeof getRuntimeBackingFileSystem>> & { symlinkCount?: number } })._fastMemoryBackingFs;
  if (
    !fastMem ||
    !(context as { _hasInfiniteFsOpsLimit?: boolean })._hasInfiniteFsOpsLimit ||
    fastMem.capabilitiesFor !== undefined ||
    fastMem.symlinkCount !== 0 ||
    fastMem.capabilities.stat === false ||
    fastMem.capabilities.read === false ||
    fastMem.capabilities.readdir === false ||
    fastMem.capabilities.realpath === false
  ) {
    return undefined;
  }
  const runner = pooledRgFastRunner ??= new PooledRgFastRunner();
  if (runner.inUse) return undefined;
  runner.inUse = true;
  let committing = false;
  let pendingFlush = false;
  try {
    context.signal.throwIfAborted();
    if ((executor as unknown as { disposed?: boolean }).disposed) return undefined;
    const limits = runner.limits;
    limits.resetForRun(context, options);
    limits.speculative = true;
    const args = parse(context.args, runner.args);
    if (
      args.help ||
      args.version ||
      args.patternFiles.length !== 0 ||
      args.mode === "json" ||
      (!args.quiet && args.mode === "lines") ||
      args.before > 0 ||
      args.after > 0 ||
      args.stats ||
      args.globs.length !== 0 ||
      args.types.length !== 0 ||
      (args.ignoreFiles && args.ignorePaths.length !== 0)
    ) {
      return undefined;
    }
    const selPaths = args.paths.length
      ? args.paths
      : (args.mode === "files" || options.defaultInput === "cwd"
        ? DEFAULT_CWD_PATHS
        : (options.defaultInput === "stdin" || context.stdinIsDefault === false ? DEFAULT_STDIN_PATHS : DEFAULT_CWD_PATHS));
    if (selPaths.length !== 1 || selPaths[0] === "-") return undefined;
    const selImplicit = args.paths.length === 0 && selPaths === DEFAULT_CWD_PATHS;
    if (args.mode !== "files") {
      if (args.patterns.length !== 1 || options.regexExecutor !== undefined || !inProcessRegexProviders.has(executor.provider)) {
        return undefined;
      }
      const pat = args.patterns[0]!;
      if (pat.length * 3 > limits.maxPatternBytesSmi && Buffer.byteLength(pat) > limits.maxPatternBytes) return undefined;
      runner.matcher.resetForRun(args.patterns, args, DUMMY_SESSION, true, true);
      if (runner.matcher.literalAsciiBytes === undefined) return undefined;
      if (!args.hasInfiniteMaxCount && args.maxCount === 0) return RESOLVED_EXIT_ONE;
    }
    runner.walker.resetForRun(context, args, limits, DUMMY_REPORT, DUMMY_SESSION);
    runner.printer.resetForRun(args, limits);
    const totals = runner.totals;
    totals.searches = 0;
    totals.searches_with_match = 0;
    totals.bytes_searched = 0;
    totals.bytes_printed = 0;
    totals.matched_lines = 0;
    totals.matches = 0;
    runner.context = context;
    runner.fastReadBacking = fastMem;
    runner.found = false;
    runner.abortedToSlow = false;
    const walkRes = runner.walker.walkTargetsSyncOrAsync(selPaths, selImplicit, runner.boundOnTarget, true);
    if (runner.abortedToSlow || walkRes !== undefined) {
      limits.outPos = 0;
      limits.flushSyncOrAsync();
      return undefined;
    }
    committing = true;
    const result = runner.found ? RESOLVED_EXIT_ZERO : RESOLVED_EXIT_ONE;
    const flushRes = limits.flushSyncOrAsync();
    if (flushRes === undefined) return result;
    pendingFlush = true;
    return flushRes.then(() => result).finally(() => { runner.inUse = false; });
  } catch (error) {
    if (committing) throw error;
    runner.limits.outPos = 0;
    runner.limits.flushSyncOrAsync();
    return undefined;
  } finally {
    runner.limits.speculative = false;
    runner.context = DUMMY_CONTEXT;
    runner.fastReadBacking = undefined;
    runner.inUse = pendingFlush;
  }
}

export function createRgCommand(executor: RegexExecutor, options: SearchOptions = {}): CommandDefinition {
  return {
    name: "rg",
    filesystemRequirements: searchRequirements,
    description: "Search virtual files or stdin with recursive filtering and structured results",
    execute(context) {
      const fastSync = tryExecuteRgFastSync(context, executor, options);
      if (fastSync !== undefined) return fastSync;
      return withRegexSession(context, executor, session => {
        let args: Arguments | undefined;
        let limits: Limits | undefined;
        let failed = false;
        let found = false;
        try {
          limits = new Limits(context, options);
          args = parse(context.args);
          if (
            !args.help &&
            !args.version &&
            !(args.mode !== "files" && args.patternFiles.includes("-") && args.paths.includes("-")) &&
            args.patternFiles.length === 0 &&
            args.mode !== "json" &&
            !args.stats &&
            inProcessRegexProviders.has(executor.provider)
          ) {
            const selection = selectInput(context, args, options);
            const report = async (error: unknown) => {
              context.signal.throwIfAborted();
              failed = true;
              await limits!.flush();
              if (args!.messages) await diagnostic(context, error);
            };
            const walker = new Walker(context, args, limits, report, session);
            if (!walker.needsValidation()) {
              let activePatterns: readonly string[];
              if (args.mode === "files") {
                activePatterns = [];
              } else {
                let bytes = 0;
                for (let i = 0; i < args.patterns.length; i++) {
                  bytes += Buffer.byteLength(args.patterns[i]!);
                  if (bytes > limits.maxPatternBytes) throw new SearchError("pattern byte limit exceeded");
                }
                activePatterns = args.patterns;
              }
              const matcher = new Matcher(activePatterns, args, session, options.regexExecutor === undefined && inProcessRegexProviders.has(executor.provider));
              if (args.mode === "files" || matcher.literalAsciiBytes !== undefined) {
                if (args.mode !== "files" && args.maxCount === 0) return RESOLVED_EXIT_ONE;
                const printer = new Printer(args, limits);
                const totals = stats();
                const multiPaths = selection.paths.length > 1;
                const fastMem = (context as { _fastMemoryBackingFs?: ReturnType<typeof getRuntimeBackingFileSystem> })._fastMemoryBackingFs;
                let fastReadState: 0 | 1 | -1 = fastMem && fastMem.capabilitiesFor === undefined && fastMem.capabilities.read !== false ? 1 : 0;
                let fastReadBacking: ReturnType<typeof getRuntimeBackingFileSystem> = fastReadState === 1 ? fastMem : undefined;
                let runTargetSlow: ((target: FileTarget, showFilename: boolean) => Promise<boolean>) | undefined;
                const getRunTargetSlow = () => (runTargetSlow ??= async (target: FileTarget, showFilename: boolean): Promise<boolean> => {
                  const snapshotTarget: FileTarget = { path: target.path, label: target.label, explicit: target.explicit, recursive: target.recursive, ...(target.canonicalPath !== undefined ? { canonicalPath: target.canonicalPath } : {}) };
                  try {
                    const result = await searchFile(context, args!, limits!, matcher, printer, snapshotTarget, context.stdin, showFilename);
                    found ||= result.found;
                    totals.searches += result.stats.searches;
                    totals.searches_with_match += result.stats.searches_with_match;
                    totals.bytes_searched += result.stats.bytes_searched;
                    totals.bytes_printed += result.stats.bytes_printed;
                    totals.matched_lines += result.stats.matched_lines;
                    totals.matches += result.stats.matches;
                    if (!args!.stats && args!.quiet && found && args!.mode !== "json") return false;
                  } catch (error) { if (error instanceof SearchError || error instanceof RegexExecutionError) throw error; await report(error); }
                  return true;
                });
                const walkRes = walker.walkTargetsSyncOrAsync(selection.paths, selection.implicit, target => {
                  if (args!.mode === "files") {
                    found = true;
                    if (!args!.quiet) {
                      const fRes = printer.filenameSyncOrAsync(target.label);
                      return fRes ? fRes.then(() => true) : true;
                    }
                    return false;
                  }
                  const showFilename = args!.filename ?? (target.recursive || multiPaths);
                  try {
                    if (fastReadState === 0 && target.canonicalPath) {
                      const b = getRuntimeBackingFileSystem(context.fs);
                      if (!b || b.capabilitiesFor !== undefined || context.fs.capabilities.read === false || b.capabilities.read === false) {
                        fastReadState = -1;
                      } else {
                        assertCommandRequirements(context, searchRequirements, ["file"]);
                        fastReadBacking = b;
                        fastReadState = 1;
                      }
                    }
                    const syncOut = fastReadState === 1 ? trySearchFileSync(context, args!, limits!, matcher, printer, target, showFilename, totals, fastReadBacking) : undefined;
                    if (typeof syncOut === "boolean") {
                      found ||= syncOut;
                      if (!args!.stats && args!.quiet && found && args!.mode !== "json") return false;
                      return true;
                    }
                    if (syncOut instanceof Promise) {
                      return syncOut.then(f => {
                        if (f === undefined) return getRunTargetSlow()(target, showFilename);
                        found ||= f;
                        return !(!args!.stats && args!.quiet && found && args!.mode !== "json");
                      }, async error => {
                        if (error instanceof SearchError || error instanceof RegexExecutionError) throw error;
                        await report(error);
                        return true;
                      });
                    }
                  } catch (error) {
                    if (error instanceof SearchError || error instanceof RegexExecutionError) throw error;
                    return report(error).then(() => true);
                  }
                  return getRunTargetSlow()(target, showFilename);
                });
                if (walkRes === undefined) {
                  const flushRes = limits.flushSyncOrAsync();
                  if (flushRes === undefined && !failed) {
                    return (args.quiet && found) || found ? RESOLVED_EXIT_ZERO : RESOLVED_EXIT_ONE;
                  }
                  return (async () => {
                    if (flushRes) await flushRes;
                    return { exitCode: args!.quiet && found ? 0 : failed ? 2 : found ? 0 : 1 };
                  })().catch(async error => {
                    context.signal.throwIfAborted();
                    if (error instanceof OutputClosed) return { exitCode: 0 };
                    try { await limits?.flush(); } catch (flushErr) { if (flushErr instanceof OutputClosed) return { exitCode: 0 }; }
                    if (args?.messages !== false) await diagnostic(context, error);
                    return { exitCode: 2 };
                  });
                }
                return (async () => {
                  await walkRes;
                  await limits!.flush();
                  return { exitCode: args!.quiet && found ? 0 : failed ? 2 : found ? 0 : 1 };
                })().catch(async error => {
                  context.signal.throwIfAborted();
                  if (error instanceof OutputClosed) return { exitCode: 0 };
                  try { await limits?.flush(); } catch (flushErr) { if (flushErr instanceof OutputClosed) return { exitCode: 0 }; }
                  if (args?.messages !== false) await diagnostic(context, error);
                  return { exitCode: 2 };
                });
              }
            }
          }
        } catch (syncError) {
          return (async () => {
            context.signal.throwIfAborted();
            if (syncError instanceof OutputClosed) return { exitCode: 0 };
            try { await limits?.flush(); } catch (flushErr) { if (flushErr instanceof OutputClosed) return { exitCode: 0 }; }
            if (args?.messages !== false) await diagnostic(context, syncError);
            return { exitCode: 2 };
          })();
        }
        return (async () => {
        try {
          limits = new Limits(context, options);
          args = parse(context.args);
          if (args.help) {
            await limits.output(Buffer.from(`Usage: rg [OPTIONS] PATTERN [PATH ...]
Search files for PATTERN. PATH - reads standard input.
Default input depends on shell configuration.

  -e, --regexp=PATTERN     Add a pattern (repeatable)
  -f, --file=FILE          Read patterns from FILE
  -r, --replace=TEXT       Replace matches with literal TEXT
      --trim              Trim leading ASCII whitespace
  -F, --fixed-strings      Use fixed strings
      --max-filesize=SIZE  Filter discovered files (bytes or K/M/G)
      --ignore-file=FILE   Read an explicit virtual ignore file
      --no-ignore-files   Disable explicit ignore files
      --ignore-files      Enable explicit ignore files
      --maxdepth=NUM      Alias for --max-depth
  -j, --threads=NUM        Accept a count (virtual execution stays serial)
  -U, --multiline          Admit line-compatible searches only
  -i, --ignore-case        Ignore case distinctions
  -s, --case-sensitive     Match case sensitively
  -S, --smart-case         Infer case sensitivity from the pattern
  -v, --invert-match       Select nonmatching lines
  -w, --word-regexp        Match whole words
  -x, --line-regexp        Match whole lines
  -n, --line-number        Print line numbers
  -N, --no-line-number     Suppress line numbers
  -H, --with-filename      Print filenames
  -I, --no-filename        Suppress filenames
  -o, --only-matching      Print matching parts
  -l, --files-with-matches Print filenames with matches
      --files-without-match Print filenames without matches
      --files             List files without searching
  -c, --count              Print matching line counts
      --count-matches     Print match counts
      --json              Emit JSON events
      --stats             Report aggregate search statistics
  -q, --quiet              Suppress normal output
  -g, --glob=GLOB          Include or exclude paths (repeatable)
      --iglob=GLOB        Case-insensitive glob
  -t, --type=TYPE          Include a file type
  -T, --type-not=TYPE      Exclude a file type
  -., --hidden             Search hidden files
  -L, --follow             Follow symbolic links
      --no-ignore         Disable ignore-file filtering
  -u, --unrestricted       Relax ignore, hidden and binary filtering (repeatable)
  -a, --text               Search binary files as text
  -A, --after-context=NUM  Print NUM lines after matches
  -B, --before-context=NUM Print NUM lines before matches
  -C, --context=NUM        Print NUM lines before and after matches
  -m, --max-count=NUM      Limit matching lines per file
      --max-depth=NUM     Limit directory traversal depth
      --column            Print columns
  -b, --byte-offset        Print byte offsets
  -0, --null               NUL-terminate filenames
      --null-data         Use NUL-delimited records
      --crlf              Handle CRLF line endings
      --heading           Group output by filename
      --sort=path         Sort paths
      --color=never       Disable color
  -h, --help              Display this help and exit
  -V, --version           Display implementation information and exit
      --                  End options

Exit status: 0 when a match is found, 1 when none is found, 2 on error.
Regular expression support depends on the configured regex executor.
The default supports UTF-8 literals and bounded ASCII regular expressions.
Regex operators: . ^ $ [...] (...) | * + ? {n,m}; -F treats patterns literally.
Case and word selection support ASCII patterns and subjects.
Unicode selection and extended regex syntax require a configured executor.
`));
            await limits.flush();
            return { exitCode: 0 };
          }
          if (args.version) {
            await limits.output(Buffer.from(`rg (safe-bash bounded implementation)\n${args.version === "long" ? `Regex engine: ${options.regexExecutor === undefined ? "bounded ASCII regular expressions and UTF-8 literals" : "configured bounded regex executor (capabilities depend on provider)"}\nNative ripgrep revision, PCRE2 and SIMD capabilities are not reported by this implementation.\n` : ""}`));
            await limits.flush();
            return { exitCode: 0 };
          }
          if (args.mode !== "files" && args.patternFiles.includes("-") && args.paths.includes("-")) {
            throw new SearchError("cannot search stdin while also reading patterns from stdin");
          }
          const selection = selectInput(context, args, options);
          const report = async (error: unknown) => {
            context.signal.throwIfAborted(); failed = true;
            await limits!.flush();
            if (args!.messages) await diagnostic(context, error);
          };
          const walker = new Walker(context, args, limits, report, session);
          if (walker.needsValidation()) await walker.validate();
          let activePatterns: readonly string[];
          if (args.mode === "files") {
            activePatterns = [];
          } else if (args.patternFiles.length === 0) {
            let bytes = 0;
            for (let i = 0; i < args.patterns.length; i++) {
              bytes += Buffer.byteLength(args.patterns[i]!);
              if (bytes > limits.maxPatternBytes) throw new SearchError("pattern byte limit exceeded");
            }
            activePatterns = args.patterns;
          } else {
            activePatterns = await patterns(context, args, limits);
          }
          const matcher = new Matcher(activePatterns, args, session, options.regexExecutor === undefined && inProcessRegexProviders.has(executor.provider));
          if (args.mode !== "files" && matcher.literalAsciiBytes === undefined) {
            const initBatch = matcher.batchSync(EMPTY_RG_LINES);
            if (initBatch instanceof Promise) await initBatch;
          }
          if (args.mode !== "files" && args.maxCount === 0) return { exitCode: 1 };
          const printer = new Printer(args, limits);
          const totals = stats();
          const multiPaths = selection.paths.length > 1;
          let fastReadState: 0 | 1 | -1 = 0;
          let fastReadBacking: ReturnType<typeof getRuntimeBackingFileSystem>;
          let runTargetSlow: ((target: FileTarget, showFilename: boolean) => Promise<boolean>) | undefined;
          const getRunTargetSlow = () => (runTargetSlow ??= async (target: FileTarget, showFilename: boolean): Promise<boolean> => {
            const snapshotTarget: FileTarget = { path: target.path, label: target.label, explicit: target.explicit, recursive: target.recursive, ...(target.canonicalPath !== undefined ? { canonicalPath: target.canonicalPath } : {}) };
            try {
              const result = await searchFile(context, args!, limits!, matcher, printer, snapshotTarget, context.stdin, showFilename);
              found ||= result.found;
              totals.searches += result.stats.searches;
              totals.searches_with_match += result.stats.searches_with_match;
              totals.bytes_searched += result.stats.bytes_searched;
              totals.bytes_printed += result.stats.bytes_printed;
              totals.matched_lines += result.stats.matched_lines;
              totals.matches += result.stats.matches;
              if (!args!.stats && args!.quiet && found && args!.mode !== "json") return false;
            } catch (error) { if (error instanceof SearchError || error instanceof RegexExecutionError) throw error; await report(error); }
            return true;
          });
          await walker.walkTargets(selection.paths, selection.implicit, target => {
              if (args!.mode === "files") {
                found = true;
                if (!args!.quiet) {
                  const fRes = printer.filenameSyncOrAsync(target.label);
                  return fRes ? fRes.then(() => true) : true;
                }
                return false;
              }
              const showFilename = args!.filename ?? (target.recursive || multiPaths);
              try {
                if (fastReadState === 0 && target.canonicalPath) {
                  const b = getRuntimeBackingFileSystem(context.fs);
                  if (!b || b.capabilitiesFor !== undefined || context.fs.capabilities.read === false || b.capabilities.read === false) {
                    fastReadState = -1;
                  } else {
                    assertCommandRequirements(context, searchRequirements, ["file"]);
                    fastReadBacking = b;
                    fastReadState = 1;
                  }
                }
                const syncOut = fastReadState === 1 ? trySearchFileSync(context, args!, limits!, matcher, printer, target, showFilename, totals, fastReadBacking) : undefined;
                if (typeof syncOut === "boolean") {
                  found ||= syncOut;
                  if (!args!.stats && args!.quiet && found && args!.mode !== "json") return false;
                  return true;
                }
                if (syncOut instanceof Promise) {
                  return syncOut.then(f => {
                    if (f === undefined) return getRunTargetSlow()(target, showFilename);
                    found ||= f;
                    return !(!args!.stats && args!.quiet && found && args!.mode !== "json");
                  }, async error => {
                    if (error instanceof SearchError || error instanceof RegexExecutionError) throw error;
                    await report(error);
                    return true;
                  });
                }
              } catch (error) {
                if (error instanceof SearchError || error instanceof RegexExecutionError) throw error;
                return report(error).then(() => true);
              }
              return getRunTargetSlow()(target, showFilename);
          });
          if (args.mode === "json") await printer.event("summary", { elapsed_total: elapsed, stats: totals });
          else if (args.stats) await limits.output(`\n${totals.matches} matches\n${totals.matched_lines} matched lines\n${totals.searches_with_match} files contained matches\n${totals.searches} files searched\n${totals.bytes_printed} bytes printed\n${totals.bytes_searched} bytes searched\n0.000000 seconds spent searching\n0.000000 seconds total\n`);
          await limits.flush();
          return { exitCode: args.quiet && found ? 0 : failed ? 2 : found ? 0 : 1 };
        } catch (error) {
          context.signal.throwIfAborted();
          if (error instanceof OutputClosed) return { exitCode: 0 };
          try { await limits?.flush(); } catch (flushErr) { if (flushErr instanceof OutputClosed) return { exitCode: 0 }; }
          if (args?.messages !== false) await diagnostic(context, error);
          return { exitCode: 2 };
        }
        })();
      });
    },
  };
}
