import type { CommandDefinition } from "../contracts/index.js";
import { collect, define, diagnostic, input, integer, lines, options, output, UsageError, value } from "./internal.js";

function expression(pattern: string, extended: boolean): string {
  const classes: Record<string, string> = { digit: "0-9", lower: "a-z", upper: "A-Z", alpha: "A-Za-z", alnum: "A-Za-z0-9", space: "\\t\\n\\v\\f\\r ", blank: "\\t ", xdigit: "0-9A-Fa-f" };
  let source = pattern.replace(/\[:([a-z]+):\]/gu, (_whole, name: string) => {
    if (!classes[name]) throw new UsageError(`unsupported character class '${name}'`);
    return classes[name]!;
  });
  if (source.length > 65536) throw new UsageError("pattern is too large");
  if (!extended) {
    let translated = "";
    let bracket = false;
    for (let index = 0; index < source.length; index++) {
      const character = source[index]!;
      if (character === "\\" && index + 1 < source.length) {
        const next = source[++index]!;
        translated += !bracket && "(){}+?|".includes(next) ? next : `\\${next}`;
      } else {
        if (character === "[") bracket = true;
        if (character === "]") bracket = false;
        translated += !bracket && "(){}+?|".includes(character) ? `\\${character}` : character;
      }
    }
    source = translated;
  }
  if (source.includes("(?")) throw new UsageError("lookaround and special groups are not supported");
  return source;
}

export function grepCommands(): CommandDefinition[] {
  return [define("grep", async context => {
    const parsed = options(context.args, "EFivnclLqhHowxae:f:m:sz", { "extended-regexp": "E", "fixed-strings": "F", "ignore-case": "i", "invert-match": "v", "line-number": "n", count: "c", "files-with-matches": "l", "files-without-match": "L", quiet: "q", silent: "q", "no-filename": "h", "with-filename": "H", "only-matching": "o", "word-regexp": "w", "line-regexp": "x", regexp: "e", file: "f", "max-count": "m", "no-messages": "s", text: "a", "null-data": "z" });
    const patterns: string[] = [];
    const addPatterns = (text: string, file: boolean) => {
      if (file && text === "") return;
      const parts = text.split("\n");
      if (parts.length > 1 && parts.at(-1) === "") parts.pop();
      patterns.push(...parts);
    };
    for (const pattern of parsed.values.get("e") ?? []) addPatterns(Buffer.from(pattern).toString("latin1"), false);
    for (const name of parsed.values.get("f") ?? []) addPatterns(Buffer.from(await collect(input(context, name), context.signal)).toString("latin1"), true);
    if (!parsed.flags.has("e") && !parsed.flags.has("f")) {
      if (!parsed.operands.length) throw new UsageError("missing pattern");
      addPatterns(Buffer.from(parsed.operands.shift()!).toString("latin1"), false);
    }
    if (parsed.flags.has("E") && parsed.flags.has("F")) throw new UsageError("conflicting matchers specified");
    const matchers = patterns.map(pattern => {
      let source = parsed.flags.has("F") ? pattern.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") : expression(pattern, parsed.flags.has("E"));
      if (parsed.flags.has("x")) source = `^(?:${source})$`;
      try { return new RegExp(source, parsed.flags.has("i") ? "gi" : "g"); }
      catch { throw new UsageError(`invalid regular expression '${pattern}'`); }
    });
    const matches = (text: string) => {
      const ranges: { index: number; text: string }[] = [];
      for (const matcher of matchers) {
        matcher.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = matcher.exec(text)) !== null) {
          const boundary = !parsed.flags.has("w") || !/[A-Za-z0-9_]/u.test(text[match.index - 1] ?? "") && !/[A-Za-z0-9_]/u.test(text[match.index + match[0].length] ?? "");
          if (boundary) {
            ranges.push({ index: match.index, text: match[0] });
            if (!parsed.flags.has("o")) return ranges;
          }
          if (match[0] === "") matcher.lastIndex++;
        }
      }
      return ranges.sort((left, right) => left.index - right.index || right.text.length - left.text.length);
    };
    const names = parsed.operands.length ? parsed.operands : ["-"];
    const maxCount = value(parsed, "m") === undefined ? Infinity : integer(value(parsed, "m")!);
    const delimiter = parsed.flags.has("z") ? "\0" : "\n";
    let anySelected = false;
    let failed = false;
    for (const name of names) {
      let count = 0;
      let number = 0;
      const named = name === "-" ? "(standard input)" : name;
      const prefix = (lineNumber = false) => `${!parsed.flags.has("h") && (parsed.flags.has("H") || names.length > 1) ? `${named}:` : ""}${lineNumber && parsed.flags.has("n") ? `${number}:` : ""}`;
      try {
        if (maxCount > 0) for await (const line of lines(input(context, name), parsed.flags.has("z") ? 0 : 10)) {
          context.signal.throwIfAborted();
          number++;
          const found = matches(Buffer.from(line.bytes).toString("latin1"));
          if ((found.length > 0) === parsed.flags.has("v")) continue;
          count++;
          if (!parsed.flags.has("L")) anySelected = true;
          if (parsed.flags.has("q")) return { exitCode: 0 };
          if (parsed.flags.has("l") || parsed.flags.has("L")) break;
          if (!parsed.flags.has("c")) {
            if (parsed.flags.has("o")) {
              if (!parsed.flags.has("v")) {
                let end = -1;
                for (const match of found) {
                  if (!match.text || match.index < end) continue;
                  await output(context, prefix(true));
                  await output(context, line.bytes.subarray(match.index, match.index + match.text.length));
                  await output(context, delimiter);
                  end = match.index + match.text.length;
                }
              }
            } else {
              await output(context, prefix(true)); await output(context, line.bytes); await output(context, delimiter);
            }
          }
          if (count >= maxCount) break;
        }
        if (parsed.flags.has("l") && count > 0 || parsed.flags.has("L") && count === 0) {
          await output(context, named + delimiter); anySelected = true;
        } else if (parsed.flags.has("c") && !parsed.flags.has("l") && !parsed.flags.has("L")) await output(context, prefix() + count + delimiter);
      } catch (error) {
        context.signal.throwIfAborted(); failed = true;
        if (!parsed.flags.has("s")) await diagnostic(context, error);
      }
    }
    return { exitCode: failed ? 2 : anySelected ? 0 : 1 };
  }, 2)];
}
