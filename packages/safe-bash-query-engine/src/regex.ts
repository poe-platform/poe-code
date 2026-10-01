import { utf8ByteLength } from "./bytes.js";
import { Pattern } from "safe-bash-regex-engine/text/regex";
import { ProgramError } from "safe-bash-regex-engine/text/budget";
import { Budget, JqError, JqLimitError, object, put, type Json } from "./limits.js";
import { extendedPattern } from "./capture.js";
import { describe } from "./values.js";

export async function* substituteRegex(input: Json, source: Json, flags: Json,
  replacement: (captures: Json) => AsyncIterable<Json>, budget: Budget, global = true): AsyncGenerator<Json> {
  if (typeof input !== "string") throw new JqError(`${describe(input, budget)} cannot be matched, as it is not a string`);
  if (typeof source !== "string") throw new JqError(`${describe(source, budget)} is not a string`);
  if (typeof flags !== "string" || [...flags].some(flag => !"gimns".includes(flag))) throw new JqError(`${typeof flags === "string" ? flags + "g" : describe(flags, budget)} is not a valid modifier string`);
  const work = { step: (count = 1) => budget.step(count), checkpoint: () => budget.tick(0), maxBufferBytes: budget.limits.maxValueBytes };
  try {
    budget.step(source.length);
    const pattern = new Pattern(source, true, flags.includes("i"), "jq", flags);
    let search = 0;
    let copied = 0;
    let results = [""];
    while (search <= input.length) {
      const match = await pattern.find(input, work, search);
      if (!match) break;
      const captures = object();
      for (const [name, index] of pattern.groupNames) put(captures, name, match.groups[index] ?? null);
      budget.value(captures);
      const next: string[] = [];
      let index = 0;
      for await (const value of replacement(captures)) {
        { const _p = budget.tickSync(); if (_p) await _p; }
        if (value !== null && typeof value !== "string") throw new JqError(`string ("") and ${describe(value, budget)} cannot be added`);
        budget.collection(index + 1);
        const prefix = results[index] ?? "";
        const fragment = input.slice(copied, match.start);
        const bytes = utf8ByteLength(prefix) + utf8ByteLength(fragment) + utf8ByteLength(value ?? "");
        if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
        const result = prefix + fragment + (value ?? "");
        budget.value(result);
        next.push(result);
        index++;
      }
      // An empty replacement stream leaves this match unchanged.
      if (next.length) {
        for (let index = next.length; index < results.length; index++) next.push(results[index]!);
        results = next; copied = match.end;
      }
      if (!global && !flags.includes("g")) break;
      search = match.end > match.start ? match.end : match.end + ((input.codePointAt(match.end) ?? 0) > 0xffff ? 2 : 1);
    }
    for (const prefix of results) {
      if (utf8ByteLength(prefix) + utf8ByteLength(input.slice(copied)) > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
      const result = prefix + input.slice(copied);
      budget.value(result);
      yield result;
    }
  } catch (error) {
    throw regexError(error);
  }
}


export function regexError(error: unknown): JqError {
  if (!(error instanceof ProgramError)) throw error;
  if (error.message.includes("buffer limit exceeded")) return new JqLimitError("maxValueBytes");
  const message = error.message === "unterminated bracket expression" ? "premature end of char-class"
    : error.message === "unmatched '(' in regular expression" ? "end pattern with unmatched parenthesis"
    : error.message === "quantifier without an expression" ? "target of repeat operator is not specified"
    : error.message === "reversed character range" ? "empty range in char class" : error.message;
  return new JqError(`Regex failure: ${message}`);
}

export async function* scanRegex(input: Json, source: Json, budget: Budget, modifiers: Json = null): AsyncGenerator<Json> {
  const flags = regexFlags(modifiers, budget);
  if (typeof source !== "string") throw new JqError(`${describe(source, budget)} is not a string`);
  if (typeof input !== "string") throw new JqError(`${describe(input, budget)} cannot be matched, as it is not a string`);
  if (source === "" && !flags.includes("n")) {
    const boundaries = utf8ByteLength(input) + 1;
    for (let index = 0; index < boundaries; index++) { { const _p = budget.tickSync(); if (_p) await _p; } yield ""; }
    return;
  }
  const work = { step: (count = 1) => budget.step(count), checkpoint: () => budget.tick(0), maxBufferBytes: budget.limits.maxValueBytes };
  try {
    budget.step(source.length);
    const pattern = new Pattern(flags.includes("x") ? await extendedPattern(source, budget) : source, true, flags.includes("i"), "jq", flags.includes("p") ? flags + "m" : flags);
    let search = 0;
    while (search <= input.length) {
      const match = await pattern.find(input, work, search);
      if (!match) break;
      budget.collection(pattern.groupCount);
      const value: Json = pattern.groupCount ? match.groups.slice(1).map(group => group ?? null) : match.groups[0]!;
      budget.value(value);
      yield value;
      search = match.end > match.start ? match.end : match.end + ((input.codePointAt(match.end) ?? 0) > 0xffff ? 2 : 1);
    }
  } catch (error) { throw regexError(error); }
}

export function regexFlags(modifiers: Json, budget: Budget): string {
  if (modifiers !== null && typeof modifiers !== "string") throw new JqError(`${describe(modifiers, budget)} is not a string`);
  const flags = modifiers ?? "";
  if ([...flags].some(flag => !"gimnpsx".includes(flag))) throw new JqError(`${flags} is not a valid modifier string`);
  return flags;
}

export async function* matchRegex(input: Json, source: Json, modifiers: Json, budget: Budget, test: boolean): AsyncGenerator<Json> {
  if (typeof input !== "string") throw new JqError(`${describe(input, budget)} cannot be matched, as it is not a string`);
  if (typeof source !== "string") throw new JqError(`${describe(source, budget)} is not a string`);
  const flags = regexFlags(modifiers, budget);
  const work = { step: (count = 1) => budget.step(count), checkpoint: () => budget.tick(0), maxBufferBytes: budget.limits.maxValueBytes };
  try {
    budget.step(source.length + input.length);
    const pattern = new Pattern(flags.includes("x") ? await extendedPattern(source, budget) : source, true, flags.includes("i"), "jq", flags.includes("p") ? flags + "m" : flags);
    let search = 0;
    while (search <= input.length) {
      const match = await pattern.find(input, work, search);
      if (!match) { if (test) yield false; return; }
      if (test) { yield true; return; }
      const position = (start: number, end: number) => {
        budget.step(end + start);
        return { offset: [...input.slice(0, start)].length, length: [...input.slice(start, end)].length, string: input.slice(start, end) };
      };
      const names = new Map([...pattern.groupNames].map(([name, index]) => [index, name]));
      const captures: Json[] = [];
      budget.collection(pattern.groupCount);
      for (let index = 1; index <= pattern.groupCount; index++) {
        const start = match.captureOffsets?.[index * 2];
        const end = match.captureOffsets?.[index * 2 + 1];
        captures.push({ ...(start === undefined || end === undefined ? { offset: -1, length: 0, string: null } : position(start, end)), name: names.get(index) ?? null });
      }
      const result = { ...position(match.start, match.end), captures };
      budget.value(result);
      yield result;
      if (!flags.includes("g")) return;
      if (source === "" && match.end < input.length) {
        // jq resumes an empty pattern at every UTF-8 byte, rounding interior
        // byte offsets to the next Unicode character boundary.
        const character = String.fromCodePoint(input.codePointAt(match.end)!);
        for (let repeat = 1; repeat < utf8ByteLength(character); repeat++) {
          await budget.tick();
          yield { offset: result.offset + 1, length: 0, string: "", captures: [] };
        }
      }
      search = match.end > match.start ? match.end : match.end + ((input.codePointAt(match.end) ?? 0) > 0xffff ? 2 : 1);
    }
  } catch (error) { throw regexError(error); }
}
