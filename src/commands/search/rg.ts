import { collectBytes, type ByteSource, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { Matcher, type Match } from "./matcher.js";
import { parse, SearchError, type Arguments, type SearchOptions } from "./options.js";
import { data, elapsed, Printer, stats, type Stats } from "./output.js";
import { diagnostic, fileInput, Limits, lines, OutputClosed, pathFor, type Line, type ReadState } from "./shared.js";
import { Walker, type FileTarget } from "./walk.js";

interface InputSelection { readonly paths: readonly string[]; readonly implicit: boolean }

function selectInput(context: CommandContext, args: Arguments, options: SearchOptions): InputSelection {
  if (args.paths.length) return { paths: args.paths, implicit: false };
  if (args.mode === "files" || options.defaultInput === "cwd" || args.patternFiles.includes("-")) return { paths: ["."], implicit: true };
  const stdin = options.defaultInput === "stdin" || context.stdinIsDefault === false;
  return { paths: stdin ? ["-"] : ["."], implicit: !stdin };
}

async function patterns(context: CommandContext, args: Arguments): Promise<string[]> {
  const patterns = [...args.patterns];
  for (const file of args.patternFiles) {
    const bytes = file === "-" ? await collectBytes(context.stdin, { maxBytes: 1024 * 1024, signal: context.signal })
      : await context.fs.readFile(pathFor(context, file), { signal: context.signal, maxBytes: 1024 * 1024 });
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new SearchError(`pattern file '${file}' is not UTF-8`); }
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    patterns.push(...lines.map(line => line.endsWith("\r") ? line.slice(0, -1) : line));
  }
  return patterns;
}

async function searchFile(context: CommandContext, args: Arguments, limits: Limits, matcher: Matcher, printer: Printer, target: FileTarget, stdin: ByteSource, filename: boolean): Promise<{ found: boolean; stats: Stats }> {
  const totals = stats(); totals.searches = 1;
  if (args.maxCount === 0) return { found: false, stats: totals };
  const state: ReadState = { bytesRead: 0, bytesSearched: 0, binaryOffset: null, skipped: false };
  const binary = args.binary === "text" ? "text" : args.binary === "binary" || target.explicit ? "binary" : "skip";
  const source = target.path === "-" ? stdin : fileInput(context, target.path, limits);
  const before: { line: Line; matches: Match[] }[] = [];
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
  for await (const line of lines(source, limits, state, binary, args.nullData)) {
    await limits.tick();
    if (binaryOutput && state.binaryOffset !== null && totals.matched_lines > 0) {
      await printer.binary(target.label, state.binaryOffset, filename); binaryPrinted = true; break;
    }
    const content = args.crlf && line.content.at(-1) === 13 ? line.content.subarray(0, -1) : line.content;
    const matches = matcher.matches(content, args.onlyMatching || args.mode === "json" || args.mode === "matches", line.bytes.length !== line.content.length);
    const limitedInvertedTail = args.invert && totals.matched_lines >= args.maxCount && after > 0 && line.bytes.length === line.content.length;
    const selected = (matches.length > 0) !== args.invert || limitedInvertedTail;
    if (selected) lastSelectedEnd = line.offset + line.bytes.length;
    if (selected && totals.matched_lines < args.maxCount) {
      totals.matched_lines++; totals.matches += args.invert ? 0 : matches.length;
      if (args.quiet && args.mode !== "json" || args.mode === "with" || args.mode === "without") break;
      if (selectedOutput) {
        await begin();
        if (state.binaryOffset !== null && args.mode !== "json") {
          if (!binaryPrinted) { await printer.binary(target.label, state.binaryOffset, filename); binaryPrinted = true; }
          break;
        }
        for (const previous of before) if (previous.line.number > lastPrinted) {
          await printer.record(target.label, previous.line, previous.matches, false, filename); lastPrinted = previous.line.number;
        }
        await printer.record(target.label, line, args.invert ? [] : matches, true, filename); lastPrinted = line.number;
        after = args.after;
      }
    } else if (after && selectedOutput) {
      if (selected) { totals.matched_lines++; totals.matches += args.invert && !limitedInvertedTail ? 0 : matches.length; }
      await printer.record(target.label, line, matches, selected, filename); lastPrinted = line.number; after--;
    }
    if (binaryOutput && args.before > 0 && state.binaryOffset !== null) break;
    if (totals.matched_lines >= args.maxCount && (!selectedOutput || after === 0)) {
      state.bytesSearched = Math.max(lastSelectedEnd, args.invert || line.bytes.length === line.content.length ? line.offset : 0);
      break;
    }
    before.push({ line, matches }); beforeBytes += line.bytes.length;
    while (before.length > args.before) beforeBytes -= before.shift()!.line.bytes.length;
    if (beforeBytes > limits.maxFileBytes) throw new SearchError("context buffer byte limit exceeded");
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

export function rgCommand(options: SearchOptions = {}): CommandDefinition {
  return {
    name: "rg",
    description: "Search virtual files or stdin with recursive filtering and structured results",
    async execute(context) {
      context.signal.throwIfAborted();
      let args: Arguments | undefined;
      let failed = false;
      let found = false;
      try {
        const limits = new Limits(context, options);
        args = parse(context.args);
        if (args.mode !== "files" && args.patternFiles.includes("-") && args.paths.includes("-")) {
          throw new SearchError("cannot search stdin while also reading patterns from stdin");
        }
        const report = async (error: unknown) => {
          context.signal.throwIfAborted(); failed = true;
          if (args!.messages) await diagnostic(context, error);
        };
        const walker = new Walker(context, args, limits, report);
        const matcher = new Matcher(args.mode === "files" ? [] : await patterns(context, args), args);
        if (args.mode !== "files" && args.maxCount === 0) return { exitCode: 1 };
        const selection = selectInput(context, args, options);
        const printer = new Printer(args, limits);
        const totals = stats();
        for await (const target of walker.targets(selection.paths, selection.implicit)) {
          if (args.mode === "files") { found = true; if (!args.quiet) await printer.filename(target.label); else break; continue; }
          try {
            const result = await searchFile(context, args, limits, matcher, printer, target, context.stdin, args.filename ?? (target.recursive || selection.paths.length > 1));
            found ||= result.found;
            for (const field of ["searches", "searches_with_match", "bytes_searched", "bytes_printed", "matched_lines", "matches"] as const) totals[field] += result.stats[field];
            if (args.quiet && found && args.mode !== "json") break;
          } catch (error) { if (error instanceof SearchError) throw error; await report(error); }
        }
        if (args.mode === "json") await printer.event("summary", { elapsed_total: elapsed, stats: totals });
        return { exitCode: args.quiet && found ? 0 : failed ? 2 : found ? 0 : 1 };
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof OutputClosed) return { exitCode: 0 };
        if (args?.messages !== false) await diagnostic(context, error);
        return { exitCode: 2 };
      }
    },
  };
}
