import { Pattern } from "safe-bash-regex-engine/text/regex";
import { Budget, JqError, type Json } from "./limits.js";
import { regexError } from "./regex.js";
import { describe } from "./values.js";

export async function* splitRegex(input: Json, source: Json, budget: Budget): AsyncGenerator<string> {
  await budget.tick();
  if (typeof input !== "string") throw new JqError(`${describe(input, budget)} cannot be matched, as it is not a string`);
  if (typeof source !== "string") throw new JqError(`${describe(source, budget)} is not a string`);
  budget.value(input);
  budget.value(source);
  const work = { step: (count = 1) => budget.step(count), checkpoint: () => budget.tick(0), maxBufferBytes: budget.limits.maxValueBytes };
  try {
    const pattern = new Pattern(source, true, false, "jq");
    let search = 0;
    let copied = 0;
    while (search <= input.length) {
      await budget.tick();
      const match = await pattern.find(input, work, search);
      if (!match) break;
      const part = input.slice(copied, match.start);
      budget.value(part);
      yield part;
      copied = match.end;
      search = match.end;
      if (match.start === match.end) {
        const character = String.fromCodePoint(input.codePointAt(search) ?? 0);
        search += character.length;
        const repeats = match.end < input.length ? Buffer.byteLength(character) - 1 : 0;
        if (repeats) {
          // jq resumes empty matches at each interior UTF-8 byte. Those byte
          // positions slice at the following Unicode boundary in jq strings.
          const probe = await pattern.find(`${input.slice(0, search)}\ufffd${input.slice(search)}`, work, search);
          if (probe?.start === search && probe.end === search) {
            for (let index = 0; index < repeats; index++) {
              await budget.tick();
              const field = input.slice(copied, search);
              budget.value(field);
              yield field;
              copied = search;
            }
          }
        }
      }
    }
    const tail = input.slice(copied);
    budget.value(tail);
    yield tail;
  } catch (error) { throw regexError(error); }
}
