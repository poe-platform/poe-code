import type { CommandDefinition } from "../../contracts/index.js";
import { bufferLimit, collect, diagnostic, input, integer, lines, options as parseOptions, output, UsageError, value } from "../internal.js";
import { AvailableRecords, RegexExecutor, RegexExecutionError, withRegexSession } from "../regex-execution/portable.js";
import type { GrepDescriptor } from "../regex-execution/protocol.js";
import { grepRequirements, requiredFileInput } from "./requirements.js";

export function createGrepCommands(executor: RegexExecutor): CommandDefinition[] {
  return [{ name: "grep", filesystemRequirements: grepRequirements, execute: context => withRegexSession(context, executor, async session => {
    try {
      const parsed = parseOptions(context.args, "EFivnclLqhHowxae:f:m:sz", { "extended-regexp": "E", "fixed-strings": "F", "ignore-case": "i", "invert-match": "v", "line-number": "n", count: "c", "files-with-matches": "l", "files-without-match": "L", quiet: "q", silent: "q", "no-filename": "h", "with-filename": "H", "only-matching": "o", "word-regexp": "w", "line-regexp": "x", regexp: "e", file: "f", "max-count": "m", "no-messages": "s", text: "a", "null-data": "z" });
      let positionalPattern: string | undefined;
      if (!parsed.flags.has("e") && !parsed.flags.has("f")) {
        if (!parsed.operands.length) throw new UsageError("missing pattern");
        positionalPattern = parsed.operands.shift()!;
      }
      const names = parsed.operands.length ? parsed.operands : ["-"];
      const patternFiles = parsed.values.get("f") ?? [];
      const patterns: string[] = [];
      const addPatterns = (text: string, file: boolean) => {
        if (file && text === "") return;
        const parts = text.split("\n");
        if (parts.length > 1 && parts.at(-1) === "") parts.pop();
        patterns.push(...parts);
      };
      for (const pattern of parsed.values.get("e") ?? []) addPatterns(Buffer.from(pattern).toString("latin1"), false);
      for (const name of patternFiles) {
        const source = name === "-" ? input(context) : requiredFileInput(context, grepRequirements, "pattern-file", name, bufferLimit);
        addPatterns(Buffer.from(await collect(source, context.signal)).toString("latin1"), true);
      }
      if (positionalPattern !== undefined) addPatterns(Buffer.from(positionalPattern).toString("latin1"), false);
      if (parsed.flags.has("E") && parsed.flags.has("F")) throw new UsageError("conflicting matchers specified");
      const descriptor: GrepDescriptor = {
        kind: "grep", patterns, fixed: parsed.flags.has("F"), extended: parsed.flags.has("E"),
        insensitive: parsed.flags.has("i"), whole: parsed.flags.has("x"), word: parsed.flags.has("w"),
      };
      await session.run(descriptor, []);
      const maxCount = value(parsed, "m") === undefined ? Infinity : integer(value(parsed, "m")!);
      const batchSize = Number.isFinite(maxCount) || parsed.flags.has("q") || parsed.flags.has("l") || parsed.flags.has("L") ? 1 : 128;
      const delimiter = parsed.flags.has("z") ? "\0" : "\n";
      let anySelected = false;
      let failed = false;
      for (const name of names) {
        let count = 0;
        let number = 0;
        const named = name === "-" ? "(standard input)" : name;
        const prefix = (lineNumber = false) => `${!parsed.flags.has("h") && (parsed.flags.has("H") || names.length > 1) ? `${named}:` : ""}${lineNumber && parsed.flags.has("n") ? `${number}:` : ""}`;
        try {
          const available = new AvailableRecords(parsed.flags.has("z") ? 0 : 10, bufferLimit);
          const source = name === "-" ? input(context) : requiredFileInput(context, grepRequirements, "file", name, bufferLimit);
          records: if (maxCount > 0) for await (const batch of available.batches(lines(available.source(source), parsed.flags.has("z") ? 0 : 10), line => line.bytes.length, () => batchSize)) {
            const results = await session.run(descriptor, batch.map(line => ({ bytes: line.bytes, all: parsed.flags.has("o"), terminated: line.terminated })));
            for (let index = 0; index < batch.length; index++) {
              const line = batch[index]!;
              context.signal.throwIfAborted();
              number++;
              const found = results[index]!;
              if ((found.length > 0) === parsed.flags.has("v")) continue;
              count++;
              if (!parsed.flags.has("L")) anySelected = true;
              if (parsed.flags.has("q")) return { exitCode: 0 };
              if (parsed.flags.has("l") || parsed.flags.has("L")) break records;
              if (!parsed.flags.has("c")) {
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
              if (count >= maxCount) break records;
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
