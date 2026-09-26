import { Budget, JqError, JqLimitError, type Json } from "./limits.js";

export async function splitString(input: Json, separator: Json, budget: Budget): Promise<string[]> {
  { const _p = budget.tickSync(); if (_p) await _p; }
  if (typeof input !== "string" || typeof separator !== "string") {
    throw new JqError("split input and separator must be strings");
  }
  const guaranteedFitUnits = Math.floor((budget.limits.maxValueBytes - 2) / 6);
  for (const operand of [input, separator]) {
    if (operand.length <= guaranteedFitUnits) budget.step();
    else budget.value(operand);
  }
  const result: string[] = [];
  let bytes = 2;
  const append = (start: number, end: number): void => {
    budget.collection(result.length + 1);
    const part = input.slice(start, end);
    bytes += budget.value(part) + (result.length ? 1 : 0);
    if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
    result.push(part);
  };
  if (separator.length === 0) {
    let offset = 0;
    for (const character of input) {
      { const _p = budget.tickSync(); if (_p) await _p; }
      append(offset, offset + character.length);
      offset += character.length;
    }
  } else if (input.length !== 0) {
    if (separator.length > input.length) append(0, input.length);
    else {
      const prefixes = new Int32Array(separator.length);
      let matched = 0;
      for (let index = 1; index < separator.length; index++) {
        { const _p = budget.tickSync(); if (_p) await _p; }
        while (matched > 0 && separator[index] !== separator[matched]) {
          { const _p = budget.tickSync(); if (_p) await _p; }
          matched = prefixes[matched - 1]!;
        }
        if (separator[index] === separator[matched]) matched++;
        prefixes[index] = matched;
      }
      matched = 0;
      let start = 0;
      for (let index = 0; index < input.length; index++) {
        { const _p = budget.tickSync(); if (_p) await _p; }
        while (matched > 0 && input[index] !== separator[matched]) {
          { const _p = budget.tickSync(); if (_p) await _p; }
          matched = prefixes[matched - 1]!;
        }
        if (input[index] === separator[matched]) matched++;
        if (matched === separator.length) {
          append(start, index + 1 - separator.length);
          start = index + 1;
          matched = 0;
        }
      }
      append(start, input.length);
    }
  }
  budget.value(result);
  return result;
}
