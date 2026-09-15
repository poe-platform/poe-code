import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerBitMetric } from "./integer-bit-metric.js";

/** Signed digits without radix prefixes. The decimal limit is an execution
 * policy supplied by the caller (zero disables it); validating sys settings,
 * including its minimum nonzero limit, belongs to the settings layer.
 * Output storage/work is conservatively reserved before host conversion.
 * BigInt size inspection still has the temporary-hex accounting limitation
 * documented by integerBitMetric; host conversion cannot yield mid-operation. */
export function integerDigits(value: bigint, radix: 2 | 8 | 10 | 16, meter: ExecutionMeter, maxDecimalDigits = 4300): string {
  meter.checkpoint();
  if (radix !== 2 && radix !== 8 && radix !== 10 && radix !== 16) throw new RangeError("unsupported integer radix");
  if (!Number.isSafeInteger(maxDecimalDigits) || maxDecimalDigits < 0) throw new RangeError("decimal digit limit must be a nonnegative safe integer");
  const bits = integerBitMetric(value, "bit_length", meter);
  if (radix === 10 && maxDecimalDigits !== 0 && bits > maxDecimalDigits * 3) {
    // 8**limit < 10**limit < 16**limit: only the intervening bit-length band
    // needs an exact threshold. No decimal conversion precedes this check.
    let exceeds = bits - 1 >= maxDecimalDigits * 4;
    if (!exceeds) {
      meter.checkpoint(Math.max(1, Math.ceil(maxDecimalDigits / 64)), 64 + Math.ceil(maxDecimalDigits / 2) * 2);
      const threshold = 10n ** BigInt(maxDecimalDigits);
      exceeds = value >= threshold || value <= -threshold;
      meter.checkpoint();
    }
    if (exceeds) throw new PythonRuntimeError("ValueError", `Exceeds the limit (${maxDecimalDigits} digits) for integer string conversion; use sys.set_int_max_str_digits() to increase the limit`);
  }
  // 30103/100000 is a strict upper bound for log10(2), so this never
  // under-reserves decimal digits even immediately below powers of ten.
  const digits = Math.max(1, radix === 10 ? Math.floor(bits * 30103 / 100000) + 1 : Math.ceil(bits / (radix === 2 ? 1 : radix === 8 ? 3 : 4)));
  meter.checkpoint(digits, 32 + 2 * (digits + (value < 0n ? 1 : 0)));
  const result = value.toString(radix);
  meter.checkpoint();
  return result;
}
