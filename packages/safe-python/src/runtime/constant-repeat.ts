import type { ConstantValue, ConstantValues, PrimitiveConstant, TupleConstant, SliceConstant } from "./constant-values.js";
import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

/** Exact immutable sequence repetition in either operand order. Count conversion
 * precedes empty-sequence shortcuts. Guest __index__/reflected dispatch belongs
 * to the caller. Payload/slot copies are charged before allocation, while full
 * host overhead accounting remains pending.
 */
export function constantRepeat<Value = ConstantValue>(left: PrimitiveConstant | TupleConstant<Value> | SliceConstant<unknown>, right: PrimitiveConstant | TupleConstant<Value> | SliceConstant<unknown>, values: ConstantValues, meter: ExecutionMeter): PrimitiveConstant | TupleConstant<Value> {
  meter.checkpoint();
  let source = left, multiplier = right;
  if (source.kind !== "str" && source.kind !== "bytes" && source.kind !== "tuple") { source = right; multiplier = left; }
  if (source.kind !== "str" && source.kind !== "bytes" && source.kind !== "tuple") return values.notImplemented;
  if (multiplier.kind !== "int" && multiplier.kind !== "bool") return values.notImplemented;
  const count = multiplier.kind === "int" ? multiplier.value : multiplier.value ? 1n : 0n;
  if (BigInt.asIntN(64, count) !== count) throw new PythonRuntimeError("OverflowError", "cannot fit 'int' into an index-sized integer");
  const length = source.kind === "tuple" ? source.items.length : source.value.length;
  if (length === 0 || count === 1n) return source;
  const repetitions = count < 0n ? 0n : count;
  const total = BigInt(length) * repetitions;
  if (total > (1n << 63n) - 1n) {
    if (source.kind === "tuple") throw new PythonRuntimeError("MemoryError", "");
    throw new PythonRuntimeError("OverflowError", source.kind === "str" ? "repeated string is too long" : "repeated bytes are too long");
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) exhaustAllocation(meter);
  try {
    if (source.kind === "str") return values.stringPoints(source.value.repeat(Number(repetitions), meter));
    if (source.kind === "bytes") return values.bytes(source.value.repeat(Number(repetitions), meter));
    const members = source.items;
    return values.tuple(Number(total), index => members[index % length]);
  } catch (error) {
    if (error instanceof RangeError) exhaustAllocation(meter);
    throw error;
  }
}
