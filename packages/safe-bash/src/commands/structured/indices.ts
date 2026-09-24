import { Budget, isObject, JqError, JqLimitError, type Json } from "./limits.js";
import { isNumber, numberValue } from "./numbers.js";
import { equal, indexValue, sliceValue } from "./values.js";

export async function indices(input: Json, sought: Json, budget: Budget): Promise<Json> {
  let source: ArrayLike<Json>;
  let pattern: ArrayLike<Json>;
  if (typeof input === "string" && typeof sought === "string") {
    await budget.tick(input.length + sought.length);
    // jq's string search returns UTF-8 byte offsets, including overlapping matches.
    source = Buffer.from(input);
    pattern = Buffer.from(sought);
  } else if (Array.isArray(input)) {
    source = input;
    pattern = Array.isArray(sought) ? sought : [sought];
  } else if (isObject(sought) && (input === null || typeof input === "string")) {
    if (input === null) return null;
    const start = Object.hasOwn(sought, "start") ? sought.start! : undefined;
    const end = Object.hasOwn(sought, "end") ? sought.end! : undefined;
    if ((start !== null && (!isNumber(start) || !Number.isFinite(numberValue(start))))
      || (end !== null && (!isNumber(end) || !Number.isFinite(numberValue(end))))) {
      throw new JqError("Array/string slice indices must be integers");
    }
    return sliceValue(input, start, end, budget);
  } else return indexValue(input, sought);

  const result: number[] = [];
  if (!pattern.length || pattern.length > source.length) return result;
  await budget.tick(pattern.length);
  const prefixes = new Uint32Array(pattern.length);
  let matched = 0;
  for (let index = 1; index < pattern.length; index++) {
    await budget.tick();
    while (matched > 0 && !equal(pattern[index]!, pattern[matched]!, budget)) {
      await budget.tick();
      matched = prefixes[matched - 1]!;
    }
    if (equal(pattern[index]!, pattern[matched]!, budget)) matched++;
    prefixes[index] = matched;
  }
  matched = 0;
  let bytes = 2;
  for (let index = 0; index < source.length; index++) {
    await budget.tick();
    while (matched > 0 && !equal(source[index]!, pattern[matched]!, budget)) {
      await budget.tick();
      matched = prefixes[matched - 1]!;
    }
    if (equal(source[index]!, pattern[matched]!, budget)) matched++;
    if (matched === pattern.length) {
      const position = index + 1 - pattern.length;
      budget.collection(result.length + 1);
      bytes += String(position).length + (result.length ? 1 : 0);
      if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
      result.push(position);
      matched = prefixes[matched - 1]!;
    }
  }
  return result;
}
