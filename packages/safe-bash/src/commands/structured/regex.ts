import { Pattern } from "../text-programs/regex.js";
import { ProgramError } from "../text-programs/shared.js";
import { Budget, JqError, JqLimitError, object, put, type Json } from "./limits.js";
import { describe } from "./values.js";

export async function* substituteRegex(input: Json, source: Json, flags: Json,
  replacement: (captures: Json) => AsyncIterable<Json>, budget: Budget): AsyncGenerator<Json> {
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
        await budget.tick();
        if (value !== null && typeof value !== "string") throw new JqError(`string ("") and ${describe(value, budget)} cannot be added`);
        budget.collection(index + 1);
        const prefix = results[index] ?? "";
        const fragment = input.slice(copied, match.start);
        const bytes = Buffer.byteLength(prefix) + Buffer.byteLength(fragment) + Buffer.byteLength(value ?? "");
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
      search = match.end > match.start ? match.end : match.end + ((input.codePointAt(match.end) ?? 0) > 0xffff ? 2 : 1);
    }
    for (const prefix of results) {
      if (Buffer.byteLength(prefix) + Buffer.byteLength(input.slice(copied)) > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
      const result = prefix + input.slice(copied);
      budget.value(result);
      yield result;
    }
  } catch (error) {
    throw regexError(error);
  }
}


function regexError(error: unknown): JqError {
  if (!(error instanceof ProgramError)) throw error;
  if (error.message.includes("buffer limit exceeded")) return new JqLimitError("maxValueBytes");
  const message = error.message === "unterminated bracket expression" ? "premature end of char-class"
    : error.message === "unmatched '(' in regular expression" ? "end pattern with unmatched parenthesis" : error.message;
  return new JqError(`Regex failure: ${message}`);
}

export async function* scanRegex(input: Json, source: Json, budget: Budget): AsyncGenerator<Json> {
  if (typeof source !== "string") throw new JqError(`${describe(source, budget)} is not a string`);
  if (typeof input !== "string") throw new JqError(`${describe(input, budget)} cannot be matched, as it is not a string`);
  if (source === "") {
    const boundaries = Buffer.byteLength(input) + 1;
    for (let index = 0; index < boundaries; index++) { await budget.tick(); yield ""; }
    return;
  }
  const work = { step: (count = 1) => budget.step(count), checkpoint: () => budget.tick(0), maxBufferBytes: budget.limits.maxValueBytes };
  try {
    budget.step(source.length);
    const pattern = new Pattern(source, true, false, "jq");
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
