import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { rangeIndexOf, type IntegerProgression } from "./integer-sequence.js";
import { RangeIterator } from "./range-iterator.js";

export interface RangeSearchContext<Value> {
  /** Pure payload inspection of exact int/bool only, excluding int subclasses. */
  exactInteger(value: Value): bigint | undefined;
  /** Wrap and charge a guest integer, including any runtime identity caching. */
  integer(value: bigint): Value;
  /** Rich equality with identity fast path, reflected dispatch and truth conversion. */
  equal(left: Value, right: Value): boolean;
}

/** Exact int/bool searches use constant-count arithmetic; all other values use
 * element-first guest equality. No __index__ conversion applies to the needle.
 * Generic counts may have many matches and retain signed-64-bit result limits.
 * Guest method binding, result wrapping and bigint payload accounting remain
 * external. Validated immutable range progressions are required.
 */
export function searchRange<Value>(operation: "contains" | "index" | "count", range: IntegerProgression, needle: Value, context: RangeSearchContext<Value>, meter: ExecutionMeter): boolean | bigint {
  meter.checkpoint();
  const exact = context.exactInteger(needle);
  if (exact !== undefined) {
    const index = rangeIndexOf(range, exact);
    if (operation === "contains") return index !== undefined;
    if (operation === "count") return index === undefined ? 0n : 1n;
    if (index !== undefined) return index;
    throw new PythonRuntimeError("ValueError", "range.index(x): x not in range");
  }
  const iterator = new RangeIterator(range, false, meter);
  let index = 0n, count = 0n;
  while (true) {
    const item = iterator.next();
    if (item.done) break;
    const value = context.integer(item.value);
    meter.checkpoint();
    const matches = context.equal(value, needle);
    meter.checkpoint();
    if (matches) {
      if (operation === "contains") return true;
      if (operation === "index") {
        if (index > (1n << 63n) - 1n) throw new PythonRuntimeError("OverflowError", "index exceeds C integer size");
        return index;
      }
      if (count === (1n << 63n) - 1n) throw new PythonRuntimeError("OverflowError", "count exceeds C integer size");
      count++;
    }
    if (operation === "index") index++;
  }
  if (operation === "index") throw new PythonRuntimeError("ValueError", "sequence.index(x): x not in sequence");
  return operation === "contains" ? false : count;
}
