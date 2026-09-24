import { JqError, JqLimitError, object, put, type Budget, type Json } from "./limits.js";
import { Pattern } from "../text-programs/regex.js";
import { ProgramError } from "../text-programs/shared.js";
import { describe } from "./values.js";

// Extended mode ignores unescaped whitespace/comments outside character classes.
async function extendedPattern(pattern: string, budget: Budget): Promise<string> {
  let result = "";
  let characterClass = false;
  for (let index = 0; index < pattern.length; index++) {
    await budget.tick();
    const character = pattern[index]!;
    if (character === "\\") {
      const next = pattern[++index];
      result += next === undefined ? "\\" : next === " " || next === "#" ? next : `\\${next}`;
    } else if (!characterClass && character === "#") {
      while (index + 1 < pattern.length && pattern[index + 1] !== "\n") { await budget.tick(); index++; }
    } else if (characterClass || !" \t\r\n\f\v".includes(character)) {
      result += character;
      if (character === "[") characterClass = true;
      else if (character === "]") characterClass = false;
    }
  }
  return result;
}

export async function* capture(input: Json, pattern: Json, modifiers: Json, budget: Budget): AsyncGenerator<Json> {
  if (typeof input !== "string") throw new JqError(`${describe(input, budget)} cannot be matched, as it is not a string`);
  if (typeof pattern !== "string") throw new JqError(`${describe(pattern, budget)} is not a string`);
  if (modifiers !== null && typeof modifiers !== "string") throw new JqError(`${describe(modifiers, budget)} is not a string`);
  const flags = modifiers ?? "";
  for (const flag of flags) {
    await budget.tick();
    if (!"gimnpsx".includes(flag)) throw new JqError(`${flags} is not a valid modifier string`);
  }
  await budget.tick(input.length + pattern.length);
  const source = flags.includes("x") ? await extendedPattern(pattern, budget) : pattern;
  const work = { step: (count = 1) => budget.step(count), checkpoint: () => budget.tick(0), maxBufferBytes: budget.limits.maxValueBytes };
  try {
    const regex = new Pattern(source, true, flags.includes("i"), "jq", flags.includes("p") ? flags + "m" : flags);
    let search = 0;
    while (search <= input.length) {
      await budget.tick();
      const match = await regex.find(input, work, search);
      if (!match) return;
      const result = object();
      for (const [name, index] of regex.groupNames) {
        await budget.tick();
        put(result, name, match.groups[index] ?? null);
      }
      budget.value(result);
      yield result;
      if (!flags.includes("g")) return;
      search = match.end > match.start ? match.end : match.end + ((input.codePointAt(match.end) ?? 0) > 0xffff ? 2 : 1);
    }
  } catch (error) {
    if (!(error instanceof ProgramError)) throw error;
    if (error.message.includes("buffer limit exceeded")) throw new JqLimitError("maxValueBytes");
    const diagnostic = error.message === "unterminated bracket expression" ? "premature end of char-class"
      : error.message === "unmatched '(' in regular expression" ? "end pattern with unmatched parenthesis" : error.message;
    throw new JqError(`Regex failure: ${diagnostic}`);
  }
}
