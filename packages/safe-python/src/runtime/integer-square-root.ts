import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerBitMetric } from "./integer-bit-metric.js";

/** Exact floor square root. A bit-length upper bound seeds monotone integer
 * Newton steps; no floating conversion or decimal digit limit is involved.
 * Reserve bounded operand-sized temporaries before each host BigInt operation;
 * host division itself is synchronous and cannot be interrupted mid-operation. */
export function integerSquareRoot(value: bigint, meter: ExecutionMeter): bigint {
  meter.checkpoint();
  if (value < 0n) throw new PythonRuntimeError("ValueError", "isqrt() argument must be nonnegative");
  if (value < 2n) return value;
  const bits = integerBitMetric(value, "bit_length", meter);
  const words = Math.max(1, Math.ceil(bits / 64)), bytes = Math.ceil(bits / 8);
  meter.checkpoint(words, 64 + bytes);
  let root = 1n << BigInt(Math.ceil(bits / 2));
  for (;;) {
    meter.checkpoint(words * words, 128 + 3 * bytes);
    const next = (root + value / root) >> 1n;
    meter.checkpoint();
    if (next >= root) return root;
    root = next;
  }
}
