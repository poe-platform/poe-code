import type { ConstantValue, ConstantValues } from "./constant-values.js";
import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

/** Exact builtin bool/int shifts. Reserve ceil(count/8) growth bytes before
 * nonzero left shifts; zero left shifts and right shifts do not grow the value.
 * This guards amplification, not full heap usage: original bigint payload copies,
 * temporary host objects and size-dependent CPU accounting remain unfinished.
 * A host bigint-size limit is fatal resource exhaustion, not a guest RangeError.
 */
export function integerShift(operator: string, left: ConstantValue, right: ConstantValue, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  if (operator !== "<<" && operator !== ">>") throw new Error(`unsupported integer shift operator: ${operator}`);
  if (left.kind !== "bool" && left.kind !== "int") return values.notImplemented;
  if (right.kind !== "bool" && right.kind !== "int") return values.notImplemented;
  const a = left.kind === "bool" ? (left.value ? 1n : 0n) : left.value;
  const count = right.kind === "bool" ? (right.value ? 1n : 0n) : right.value;
  if (count < 0n) throw new PythonRuntimeError("ValueError", "negative shift count");
  if (a === 0n) return values.integer(0n);
  if (operator === "<<") {
    const growth = (count + 7n) / 8n;
    if (growth > BigInt(Number.MAX_SAFE_INTEGER)) exhaustAllocation(meter);
    meter.checkpoint(0, Number(growth));
  }
  let result: bigint;
  try { result = operator === "<<" ? a << count : a >> count; }
  catch (error) {
    if (error instanceof RangeError) exhaustAllocation(meter);
    throw error;
  }
  return values.integer(result);
}
