import type { ConstantValue, ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Exact builtin bool/int bitwise pairs, not individual type dunder methods.
 * Other types decline for reflected/set behavior. Shifts are separate because
 * count conversion and result-growth limits require different handling. Tagged
 * results and entry are metered; bigint payload/CPU-size accounting is unfinished.
 */
export function integerBitwise(operator: string, left: ConstantValue, right: ConstantValue, values: ConstantValues, meter: ExecutionMeter): ConstantValue {
  meter.checkpoint();
  if (operator !== "&" && operator !== "|" && operator !== "^") throw new Error(`unsupported integer bitwise operator: ${operator}`);
  if (left.kind !== "bool" && left.kind !== "int") return values.notImplemented;
  if (right.kind !== "bool" && right.kind !== "int") return values.notImplemented;
  if (left.kind === "bool" && right.kind === "bool") {
    return values.boolean(operator === "&" ? left.value && right.value : operator === "|" ? left.value || right.value : left.value !== right.value);
  }
  const a = left.kind === "bool" ? (left.value ? 1n : 0n) : left.value;
  const b = right.kind === "bool" ? (right.value ? 1n : 0n) : right.value;
  return values.integer(operator === "&" ? a & b : operator === "|" ? a | b : a ^ b);
}
