import { alphaRanges, decimalRanges, digitRanges, numericRanges, printableRanges, lowerRanges, upperRanges, titleRanges, casedRanges, caseIgnorableRanges } from "../unicode-classification-data.js";
import type { ExecutionMeter } from "./execution-budget.js";

const ranges = { isalpha: alphaRanges, isdecimal: decimalRanges, isdigit: digitRanges, isnumeric: numericRanges, isprintable: printableRanges, islower: lowerRanges, isupper: upperRanges, istitle: titleRanges, cased: casedRanges, caseIgnorable: caseIgnorableRanges };
export type UnicodeClassification = Exclude<keyof typeof ranges, "cased" | "caseIgnorable">;

/** Binary lookup in pinned Unicode ranges. These are Python's Letter category,
 * numeric-type and printable definitions, not host regular-expression classes. */
export function isUnicodeCharacter(point: number, kind: keyof typeof ranges, meter?: ExecutionMeter): boolean {
  meter?.checkpoint();
  if (!Number.isInteger(point) || point < 0 || point > 0x10ffff) return false;
  const table = ranges[kind];
  let low = 0, high = table.length / 2;
  while (low < high) {
    meter?.checkpoint();
    const middle = low + Math.floor((high - low) / 2);
    if (point < table[middle * 2]) high = middle;
    else if (point > table[middle * 2 + 1]) low = middle + 1;
    else return true;
  }
  return false;
}
