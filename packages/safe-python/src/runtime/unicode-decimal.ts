import { decimalRanges } from "../unicode-classification-data.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Unicode decimal digit value, or -1 for a non-decimal code point. */
export function unicodeDecimal(point: number, meter: ExecutionMeter): number {
  if (point >= 48 && point <= 57) return point - 48;
  let low = 0, high = decimalRanges.length / 2;
  while (low < high) {
    meter.checkpoint();
    const middle = Math.floor((low + high) / 2), start = decimalRanges[middle * 2], end = decimalRanges[middle * 2 + 1];
    if (point < start) high = middle;
    else if (point > end) low = middle + 1;
    else return (point - start) % 10;
  }
  return -1;
}
