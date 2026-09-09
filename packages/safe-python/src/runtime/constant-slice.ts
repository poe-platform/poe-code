import type { ConstantValue, ConstantValues } from "./constant-values.js";
import type { SliceValues } from "./expression-evaluation.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { normalizeSlice } from "./integer-sequence.js";
import { PythonRuntimeError } from "./error.js";

function bound(value: ConstantValue | undefined, meter: ExecutionMeter): bigint | null {
  meter.checkpoint();
  if (value === undefined || value.kind === "none") return null;
  if (value.kind === "int") return value.value;
  if (value.kind === "bool") return value.value ? 1n : 0n;
  throw new PythonRuntimeError("TypeError", "slice indices must be integers or None or have an __index__ method");
}

/** Apply already-evaluated slice components to exact builtin constant sequences.
 * This is not a guest slice object or user-defined __index__/__getitem__ dispatch.
 * Step conversion and zero validation precede lower/upper conversion. Temporary
 * tuple slots are charged separately from the factory's immutable owned copy.
 */
export function constantSlice(object: ConstantValue, parts: SliceValues<ConstantValue>, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  if (object.kind !== "str" && object.kind !== "bytes" && object.kind !== "tuple") {
    const name = object.kind === "none" ? "NoneType" : object.kind === "not-implemented" ? "NotImplementedType" : object.kind;
    throw new PythonRuntimeError("TypeError", `'${name}' object is not subscriptable`);
  }
  const step = bound(parts.step, meter);
  if (step === 0n) throw new PythonRuntimeError("ValueError", "slice step cannot be zero");
  const start = bound(parts.lower, meter), stop = bound(parts.upper, meter);
  const length = object.kind === "tuple" ? object.items.length : object.value.length;
  const indices = normalizeSlice(BigInt(length), start, stop, step);
  if (indices.step === 1n && indices.start === 0n && indices.length === BigInt(length)) return object;
  if (object.kind === "str") return values.stringPoints(object.value.slice(start, stop, step, meter));
  if (object.kind === "bytes") return values.bytes(object.value.slice(start, stop, step, meter));
  const count = Number(indices.length);
  meter.checkpoint(0, count * 8);
  const items: ConstantValue[] = new Array(count);
  const stride = count > 1 ? Number(indices.step) : 0;
  for (let offset = 0, index = Number(indices.start); offset < count; offset++, index += stride) {
    meter.checkpoint(); items[offset] = object.items[index];
  }
  return values.tuple(items);
}
