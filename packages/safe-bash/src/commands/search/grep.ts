import { toByteSource, type ByteSource, type CommandDefinition } from "../../contracts/index.js";
import { bufferLimit, diagnostic, input, integer, lines, options as parseOptions, output, UsageError, value, type Line } from "../internal.js";
import { AvailableRecords, RegexExecutor, RegexExecutionError, withRegexSession } from "../regex-execution/portable.js";
import type { GrepDescriptor } from "../regex-execution/protocol.js";
import { grepRequirements, requiredFileInput } from "./requirements.js";

const maxPatternCount = 1024;

export function createGrepCommands(executor: RegexExecutor): CommandDefinition[] {
  return [{ name: "grep", filesystemRequirements: grepRequirements, execute: context => withRegexSession(context, executor, async session => {
    try {
      const contextLengths = new Map<string, number>();
      const parsed = parseOptions(context.args, "EFivnclLqhHowxae:f:m:szA:B:C:", { help: false, "extended-regexp": "E", "fixed-strings": "F", "ignore-case": "i", "invert-match": "v", "line-number": "n", count: "c", "files-with-matches": "l", "files-without-match": "L", quiet: "q", silent: "q", "no-filename": "h", "with-filename": "H", "only-matching": "o", "word-regexp": "w", "line-regexp": "x", regexp: "e", file: "f", "max-count": "m", "no-messages": "s", text: "a", "null-data": "z", "after-context": "A", "before-context": "B", context: "C" }, false, undefined, (key, index, offset) => {
        if (!["A", "B", "C"].includes(key)) return;
        const text = context.args[index]!.slice(offset);
        try { contextLengths.set(key, integer(text)); }
        catch { throw new UsageError(`${text}: invalid context length argument`); }
      });
      if (parsed.flags.has("help")) {
        await output(context, `Usage: grep [OPTION]... PATTERN [FILE]...
Print lines matching PATTERN. With no FILE, or FILE -, read standard input.

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
      if (!parsed.flags.has("e") && !parsed.flags.has("f")) {
        if (!parsed.operands.length) throw new UsageError("missing pattern");
        positionalPattern = parsed.operands.shift()!;
      }
      const names = parsed.operands.length ? parsed.operands : ["-"];
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
      const addArgument = async (pattern: string) => {
        admit(pattern, true);
        if (pattern === "") {
          if (++patternCount > maxPatternCount) throw new UsageError(`pattern count limit exceeded (${maxPatternCount})`);
          patterns.push("");
        } else {
          for await (const line of lines(toByteSource(pattern))) patterns.push(Buffer.from(line.bytes).toString("latin1"));
        }
      };
      async function* admitted(source: ByteSource): ByteSource {
        let atStart = true;
        for await (const chunk of source) {
          atStart = admit(chunk, atStart);
          yield chunk;
        }
      }
      for (const pattern of parsed.values.get("e") ?? []) await addArgument(pattern);
      for (const name of patternFiles) {
        const source = name === "-" ? input(context) : requiredFileInput(context, grepRequirements, "pattern-file", name, bufferLimit - patternBytes);
        for await (const line of lines(admitted(source))) patterns.push(Buffer.from(line.bytes).toString("latin1"));
      }
      if (positionalPattern !== undefined) await addArgument(positionalPattern);
      if (parsed.flags.has("E") && parsed.flags.has("F")) throw new UsageError("conflicting matchers specified");
      const descriptor: GrepDescriptor = {
        kind: "grep", patterns, fixed: parsed.flags.has("F"), extended: parsed.flags.has("E"),
        insensitive: parsed.flags.has("i"), whole: parsed.flags.has("x"), word: parsed.flags.has("w"),
      };
      await session.run(descriptor, []);
      const maxCount = value(parsed, "m") === undefined ? Infinity : integer(value(parsed, "m")!);
      const batchSize = Number.isFinite(maxCount) || parsed.flags.has("q") || parsed.flags.has("l") || parsed.flags.has("L") ? 1 : 128;
      const delimiter = parsed.flags.has("z") ? "\0" : "\n";
      const extractMatches = parsed.flags.has("o") && !["c", "q", "l", "L", "v"].some(flag => parsed.flags.has(flag));
      const displayLines = !["c", "q", "l", "L"].some(flag => parsed.flags.has(flag));
      const withContext = contextLengths.size > 0 && displayLines && !(parsed.flags.has("o") && parsed.flags.has("v"));
      const before = withContext ? contextLengths.get("B") ?? contextLengths.get("C") ?? 0 : 0;
      const after = withContext ? contextLengths.get("A") ?? contextLengths.get("C") ?? 0 : 0;
      let emittedGroup = false;
      let anySelected = false;
      let failed = false;
      for (const name of names) {
        let count = 0;
        let number = 0;
        let lastCovered = 0;
        let remainingAfter = 0;
        let pendingBytes = 0;
        const pending = new Map<number, Line>();
        const named = name === "-" ? "(standard input)" : name;
        const prefix = (lineNumber = false, position = number, separator = ":") => `${!parsed.flags.has("h") && (parsed.flags.has("H") || names.length > 1) ? `${named}${separator}` : ""}${lineNumber && parsed.flags.has("n") ? `${position}${separator}` : ""}`;
        const emitContext = async (line: Line, position: number) => {
          if (!parsed.flags.has("o")) {
            await output(context, prefix(true, position, "-"));
            await output(context, line.bytes);
            await output(context, delimiter);
          }
          lastCovered = position;
        };
        try {
          const available = new AvailableRecords(parsed.flags.has("z") ? 0 : 10, bufferLimit);
          const source = name === "-" ? input(context) : requiredFileInput(context, grepRequirements, "file", name, bufferLimit);
          records: if (maxCount > 0) for await (const batch of available.batches(lines(available.source(source), parsed.flags.has("z") ? 0 : 10), line => line.bytes.length, () => batchSize)) {
            const results = await session.run(descriptor, batch.map(line => ({ bytes: line.bytes, all: extractMatches, terminated: line.terminated })));
            for (let index = 0; index < batch.length; index++) {
              const line = batch[index]!;
              context.signal.throwIfAborted();
              number++;
              const found = results[index]!;
              const selected = count < maxCount && (found.length > 0) !== parsed.flags.has("v");
              if (!selected) {
                if (remainingAfter > 0) {
                  await emitContext(line, number);
                  remainingAfter--;
                  if (count >= maxCount && remainingAfter === 0) break records;
                } else if (before > 0) {
                  if (pending.size >= before) {
                    const oldest = pending.keys().next().value!;
                    pendingBytes -= pending.get(oldest)!.bytes.length + 1;
                    pending.delete(oldest);
                  }
                  const size = line.bytes.length + 1;
                  if (size > bufferLimit - pendingBytes) throw new UsageError(`context byte limit exceeded (${bufferLimit} bytes)`);
                  pending.set(number, { bytes: Uint8Array.from(line.bytes), terminated: line.terminated });
                  pendingBytes += size;
                }
                continue;
              }
              count++;
              if (!parsed.flags.has("L")) anySelected = true;
              if (parsed.flags.has("q")) return { exitCode: 0 };
              if (parsed.flags.has("l") || parsed.flags.has("L")) break records;
              if (!parsed.flags.has("c")) {
                if (withContext) {
                  const first = pending.keys().next().value ?? number;
                  if (emittedGroup && (lastCovered === 0 || first > lastCovered + 1)) await output(context, "--\n");
                  for (const [position, previous] of pending) await emitContext(previous, position);
                  pending.clear();
                  pendingBytes = 0;
                  remainingAfter = after;
                  lastCovered = number;
                  emittedGroup = true;
                }
                if (parsed.flags.has("o")) {
                  if (!parsed.flags.has("v")) {
                    let end = -1;
                    for (const match of found) {
                      if (match.start === match.end || match.start < end) continue;
                      await output(context, prefix(true));
                      await output(context, line.bytes.subarray(match.start, match.end));
                      await output(context, delimiter);
                      end = match.end;
                    }
                  }
                } else {
                  await output(context, prefix(true)); await output(context, line.bytes); await output(context, delimiter);
                }
              }
              if (count >= maxCount && remainingAfter === 0) break records;
            }
          }
          if (parsed.flags.has("l") && count > 0 || parsed.flags.has("L") && count === 0) {
            await output(context, named + delimiter); anySelected = true;
          } else if (parsed.flags.has("c") && !parsed.flags.has("l") && !parsed.flags.has("L")) await output(context, prefix() + count + delimiter);
        } catch (error) {
          context.signal.throwIfAborted();
          if (error instanceof RegexExecutionError) throw error;
          failed = true;
          if (!parsed.flags.has("s")) await diagnostic(context, error);
        }
      }
      return { exitCode: failed ? 2 : anySelected ? 0 : 1 };
    } catch (error) {
      context.signal.throwIfAborted();
      await diagnostic(context, error);
      return { exitCode: 2 };
    }
  }) }];
}
