import { tryReadMemoryFileViewSync } from "@poe-code/safe-fs/core";
import { assertCommandRequirements, collectBytes, type ByteSource, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { getRuntimeBackingFileSystem } from "../../shell/runtime.js";
import { Matcher, type Match } from "./matcher.js";
import { parse, SearchError, type Arguments, type SearchOptions } from "./options.js";
import { data, elapsed, Printer, stats, type Stats } from "./output.js";
import { diagnostic, Limits, lineBatches, trySyncLineBatches, OutputClosed, pathFor, type Line, type ReadState } from "./shared.js";
import { Walker, type FileTarget } from "./walk.js";
import { RegexExecutor, RegexExecutionError, withRegexSession } from "../regex-execution/portable.js";
import { assertPathRequirements, requiredFileInput, searchRequirements } from "./requirements.js";

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
  if (args.maxCount === 0) return { found: false, stats: totals };
  const state: ReadState = { bytesRead: 0, bytesSearched: 0, binaryOffset: null, skipped: false };
  const binary = args.binary === "text" ? "text" : args.binary === "binary" || target.explicit ? "binary" : "skip";
  const backing = target.canonicalPath ? getRuntimeBackingFileSystem(context.fs) : undefined;
  let source: ByteSource | Uint8Array;
  if (target.path === "-") {
    source = stdin;
  } else if (target.canonicalPath && backing && backing.capabilitiesFor === undefined && context.fs.capabilities.read !== false && backing.capabilities.read !== false) {
    assertCommandRequirements(context, searchRequirements, ["file"]);
    const maxBytes = Number.isFinite(limits.maxFileBytes) ? limits.maxFileBytes : undefined;
    const view = tryReadMemoryFileViewSync(backing, target.canonicalPath, maxBytes, context.signal);
    source = view ?? await backing.readFile(target.canonicalPath, { signal: context.signal, ...(maxBytes !== undefined ? { maxBytes } : {}) });
  } else {
    source = requiredFileInput(context, searchRequirements, "file", target.path, limits.maxFileBytes);
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
  const needAll = args.replacement !== undefined || args.onlyMatching || args.mode === "json" || args.mode === "matches";
  const batchSize = () => Number.isFinite(args.maxCount) || args.quiet && args.mode !== "json" || args.mode === "with" || args.mode === "without" || binaryOutput && state.binaryOffset !== null ? 1 : 128;
  const syncBatches = source instanceof Uint8Array ? trySyncLineBatches(source, limits, state, binary, args.nullData, batchSize, needAll, args.crlf, args.before === 0) : undefined;
  let syncIdx = 0;
  let asyncIter: AsyncIterator<Line[]> | undefined;
  let failed = false;
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
    const batchRes = matcher.batchSync(batch); const results = batchRes instanceof Promise ? await batchRes : batchRes;
    for (let index = 0; index < batch.length; index++) {
      const line = batch[index]!;
      state.bytesSearched = line.offset + line.rawLength;
      const tickPending = limits.tick();
      if (tickPending) await tickPending;
      if (binaryOutput && state.binaryOffset !== null && totals.matched_lines > 0) {
        await printer.binary(target.label, state.binaryOffset, filename); binaryPrinted = true; break records;
      }
      const matches = results[index]!;
      const limitedInvertedTail = args.invert && totals.matched_lines >= args.maxCount && after > 0 && line.rawLength === line.content.length;
      const selected = (matches.length > 0) !== args.invert || limitedInvertedTail;
      if (selected) lastSelectedEnd = line.offset + line.rawLength;
      if (selected && totals.matched_lines < args.maxCount) {
        totals.matched_lines++; totals.matches += args.invert ? 0 : matches.length;
        if (args.quiet && args.mode !== "json" || args.mode === "with" || args.mode === "without") break records;
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
        if (selected) { totals.matched_lines++; totals.matches += args.invert && !limitedInvertedTail ? 0 : matches.length; }
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
    failed = true;
    throw error;
  } finally {
    try { await asyncIter?.return?.(); }
    catch (error) { if (!failed) throw error; }
  }
  if (binaryOutput && state.binaryOffset !== null && totals.matched_lines > 0 && !binaryPrinted) {
    await printer.binary(target.label, state.binaryOffset, filename);
  }
  const matched = totals.matched_lines > 0;
  const found = args.mode === "without" ? !matched && !state.skipped : matched;
  totals.searches_with_match = matched ? 1 : 0;
  totals.bytes_searched = state.bytesSearched;
  if (!args.quiet) {
    if ((args.mode === "with" || args.mode === "without") && found) await printer.filename(target.label);
    if ((args.mode === "count" || args.mode === "matches") && (matched || args.includeZero) && !state.skipped) {
      const amount = !args.invert && (args.mode === "matches" || args.onlyMatching) ? totals.matches : totals.matched_lines;
      await printer.count(target.label, amount, filename);
    }
    if (begun && args.mode === "json") {
      totals.bytes_printed = limits.outputBytes - fileOutputStart;
      await printer.event("end", { path: data(Buffer.from(target.label)), binary_offset: state.binaryOffset, stats: totals });
    }
  }
  return { found, stats: totals };
}

export function createRgCommand(executor: RegexExecutor, options: SearchOptions = {}): CommandDefinition {
  return {
    name: "rg",
    filesystemRequirements: searchRequirements,
    description: "Search virtual files or stdin with recursive filtering and structured results",
    async execute(context) {
      return withRegexSession(context, executor, async session => {
        let args: Arguments | undefined;
        let limits: Limits | undefined;
        let failed = false;
        let found = false;
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
          await walker.validate();
          const matcher = new Matcher(args.mode === "files" ? [] : await patterns(context, args, limits), args, session);
          if (args.mode !== "files") await matcher.batch([]);
          if (args.mode !== "files" && args.maxCount === 0) return { exitCode: 1 };
          const printer = new Printer(args, limits);
          const totals = stats();
          for (const p of selection.paths) {
            if (p !== "-") await assertPathRequirements(context, searchRequirements, ["metadata"], [p]);
            await walker.walkTargets([p], selection.implicit, async target => {
            if (args!.mode === "files") {
              found = true;
              if (!args!.quiet) { await printer.filename(target.label); return true; }
              return false;
            }
            try {
              const result = await searchFile(context, args!, limits!, matcher, printer, target, context.stdin, args!.filename ?? (target.recursive || selection.paths.length > 1));
              found ||= result.found;
              totals.searches += result.stats.searches;
              totals.searches_with_match += result.stats.searches_with_match;
              totals.bytes_searched += result.stats.bytes_searched;
              totals.bytes_printed += result.stats.bytes_printed;
              totals.matched_lines += result.stats.matched_lines;
              totals.matches += result.stats.matches;
              if (args!.quiet && found && args!.mode !== "json") return false;
            } catch (error) { if (error instanceof SearchError || error instanceof RegexExecutionError) throw error; await report(error); }
            return true;
            });
            if (args.quiet && found && args.mode !== "json" || args.mode === "files" && args.quiet && found) break;
          }
          if (args.mode === "json") await printer.event("summary", { elapsed_total: elapsed, stats: totals });
          await limits.flush();
          return { exitCode: args.quiet && found ? 0 : failed ? 2 : found ? 0 : 1 };
        } catch (error) {
          context.signal.throwIfAborted();
          if (error instanceof OutputClosed) return { exitCode: 0 };
          try { await limits?.flush(); } catch (flushErr) { if (flushErr instanceof OutputClosed) return { exitCode: 0 }; }
          if (args?.messages !== false) await diagnostic(context, error);
          return { exitCode: 2 };
        }
      });
    },
  };
}
