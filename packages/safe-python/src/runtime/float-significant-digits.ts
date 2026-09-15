import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { floatAsIntegerRatio } from "./numeric-conversion.js";

/** Unsigned significant digits with a base-ten exponent for the first digit.
 * Uses the exact terminating decimal expansion, not a rounded host decimal
 * approximation. Arithmetic stays bounded by binary64 even at huge precision.
 */
export function floatSignificantDigits(value: number, precision: bigint, meter: ExecutionMeter): { digits: string; exponent: number } {
  meter.checkpoint();
  if (!Number.isFinite(value) || precision < 1n) throw new RangeError("significant digits require a finite value and positive precision");
  if (precision > 0xffffffffn) exhaustAllocation(meter);
  const count = Number(precision);
  meter.checkpoint(count, 128 + count * 8);
  if (value === 0) return { digits: "0".repeat(count), exponent: 0 };
  const { numerator, denominator } = floatAsIntegerRatio(Math.abs(value), meter);
  // The ratio denominator is a power of two no larger than 2**1074.
  meter.checkpoint(1075, 32 + 1075 * 2);
  const scale = denominator.toString(2).length - 1;
  // n / 2**k = (n * 5**k) / 10**k. Conservatively reserve bounded
  // coefficient arithmetic and decimal conversion before invoking the host.
  meter.checkpoint(scale + 1, 4096 + 1075 * 2);
  const coefficient = (numerator * 5n ** BigInt(scale)).toString(10);
  let exponent = coefficient.length - scale - 1;
  meter.checkpoint();
  if (count >= coefficient.length) return { digits: coefficient.padEnd(count, "0"), exponent };
  let digits = coefficient.slice(0, count);
  const next = coefficient.charCodeAt(count);
  let roundUp = next > 53;
  if (next === 53) {
    roundUp = (digits.charCodeAt(count - 1) & 1) !== 0;
    for (let i = count + 1; !roundUp && i < coefficient.length; i++) {
      meter.checkpoint();
      roundUp = coefficient.charCodeAt(i) !== 48;
    }
  }
  if (roundUp) {
    // count is smaller than the bounded exact coefficient here, regardless
    // of the caller's requested precision. No unbounded BigInt parsing.
    meter.checkpoint(count, 128 + count * 4);
    digits = (BigInt(digits) + 1n).toString(10);
    if (digits.length > count) { digits = digits.slice(0, count); exponent++; }
  }
  meter.checkpoint();
  return { digits, exponent };
}
