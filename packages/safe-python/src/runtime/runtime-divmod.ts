import type { ExecutionMeter } from "./execution-budget.js";
import { floatDivmod } from "./float-arithmetic.js";
import { integerDivmod } from "./integer-arithmetic.js";
import { integerBitMetric } from "./integer-bit-metric.js";
import { integerToFloat } from "./numeric-conversion.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Exact real divmod slots, declining unsupported pairs without guest coercion.
 * Shared by the builtin fast path and mixed native/guest numeric negotiation. */
export function runtimeDivmod(left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter): RuntimeValue {
  meter.checkpoint();
  if (left.kind !== "bool" && left.kind !== "int" && left.kind !== "float") return values.notImplemented;
  if (right.kind !== "bool" && right.kind !== "int" && right.kind !== "float") return values.notImplemented;
  const a = left.kind === "bool" ? (left.value ? 1n : 0n) : left.value;
  const b = right.kind === "bool" ? (right.value ? 1n : 0n) : right.value;
  let bits = 0;
  if (typeof a === "bigint") bits += integerBitMetric(a, "bit_length", meter);
  if (typeof b === "bigint") bits += integerBitMetric(b, "bit_length", meter);
  // Charge intermediate records, argument slots and bigint payloads before the
  // host arithmetic. As with other bigint kernels, host division is indivisible.
  meter.checkpoint(1 + Math.ceil(bits / 64), 128 + 4 * Math.ceil(bits / 8));
  if (typeof a === "bigint" && typeof b === "bigint") {
    const { quotient, remainder } = integerDivmod(a, b);
    return values.tuple([values.integer(quotient), values.integer(remainder)]);
  }
  const x = typeof a === "bigint" ? integerToFloat(a) : a;
  const y = typeof b === "bigint" ? integerToFloat(b) : b;
  const { quotient, remainder } = floatDivmod(x, y);
  return values.tuple([values.float(quotient), values.float(remainder)]);
}
