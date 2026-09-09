import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface UnpackedAssignment<Value> {
  readonly leading: readonly Value[];
  readonly starred: readonly Value[] | undefined;
  readonly trailing: readonly Value[];
}

/** Unpack an adapted guest iterator before assigning any targets at this level.
 * after=null means no starred target. An optional remainder preparation callback
 * performs the starred path's iterator/length-hint protocol after the prefix;
 * it may return a different iterator or raise. Guest protocol execution and heap
 * accounting belong to the caller. No iterator return/close operation is implied.
 * This is the generic iterator path, not exact built-in sequence fast paths.
 */
export function unpackAssignment<Value>(
  iterator: Iterator<Value>, before: number, after: number | null,
  meter: ExecutionMeter, prepareRemainder?: () => Iterator<Value>
): UnpackedAssignment<Value> {
  meter.checkpoint();
  const required = before + (after ?? 0);
  if (!Number.isSafeInteger(before) || before < 0 ||
      (after !== null && (!Number.isSafeInteger(after) || after < 0)) || !Number.isSafeInteger(required)) {
    throw new RangeError("assignment target counts must be nonnegative safe integers");
  }
  const leading: Value[] = [];
  for (let index = 0; index < before; index++) {
    meter.checkpoint();
    const item = iterator.next();
    if (item.done) throw new PythonRuntimeError("ValueError", `not enough values to unpack (expected ${after === null ? "" : "at least "}${required}, got ${index})`);
    leading.push(item.value);
  }
  if (after === null) {
    meter.checkpoint();
    if (!iterator.next().done) throw new PythonRuntimeError("ValueError", `too many values to unpack (expected ${before})`);
    return { leading, starred: undefined, trailing: [] };
  }
  meter.checkpoint();
  const remainder = prepareRemainder === undefined ? iterator : prepareRemainder();
  const starred: Value[] = [];
  while (true) {
    meter.checkpoint();
    const item = remainder.next();
    if (item.done) break;
    starred.push(item.value);
  }
  if (starred.length < after) throw new PythonRuntimeError("ValueError", `not enough values to unpack (expected at least ${required}, got ${before + starred.length})`);
  meter.checkpoint(after + 1);
  const trailing = starred.splice(starred.length - after, after);
  return { leading, starred, trailing };
}
