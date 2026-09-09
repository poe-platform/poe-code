import type { ConstantValue, ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Concatenate matching exact immutable sequence kinds. This kernel declines
 * mismatches; the caller owns reflected dispatch and sequence-specific errors.
 * Byte storage is adopted once; string and tuple temporary copies are explicitly
 * charged. Complete host object/array overhead accounting remains unfinished.
 */
export function constantConcat(left: ConstantValue, right: ConstantValue, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  if (left.kind === "str" && right.kind === "str") {
    if (left.value.length === 0) return right;
    if (right.value.length === 0) return left;
    return values.stringPoints(left.value.concat(right.value, meter));
  }
  if (left.kind === "bytes" && right.kind === "bytes") {
    if (left.value.length === 0) return right;
    if (right.value.length === 0) return left;
    return values.bytes(left.value.concat(right.value, meter));
  }
  if (left.kind === "tuple" && right.kind === "tuple") {
    if (left.items.length === 0) return right;
    if (right.items.length === 0) return left;
    const length = left.items.length + right.items.length;
    meter.checkpoint(0, length * 8);
    const items: ConstantValue[] = new Array(length);
    for (let i = 0; i < left.items.length; i++) { meter.checkpoint(); items[i] = left.items[i]; }
    for (let i = 0; i < right.items.length; i++) { meter.checkpoint(); items[left.items.length + i] = right.items[i]; }
    return values.tuple(items);
  }
  return values.notImplemented;
}
