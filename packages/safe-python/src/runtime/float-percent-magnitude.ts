import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { floatFixedDigits } from "./float-fixed-digits.js";
import { floatSignificantDigits } from "./float-significant-digits.js";

/** Unsigned e/f/g output. Sign selection and field width belong to the caller.
 * General notation is selected after rounding, so decimal carries can change
 * both the exponent and the selected notation. addDotZero selects modern
 * omitted-type general notation, reserving a digit after the decimal point. */
export function floatPercentMagnitude(value: number, code: number, precision: bigint | null, alternate: boolean, meter: ExecutionMeter, addDotZero = false): string {
  meter.checkpoint();
  const upper = code === 69 || code === 70 || code === 71;
  const scientific = code === 69 || code === 101, fixed = code === 70 || code === 102;
  if (!scientific && !fixed && code !== 71 && code !== 103 || precision !== null && precision < 0n) throw new RangeError("invalid floating percent metadata");
  if (!Number.isFinite(value)) return Number.isNaN(value) ? upper ? "NAN" : "nan" : upper ? "INF" : "inf";
  const requested = precision ?? 6n;
  if (fixed) {
    const digits = floatFixedDigits(value, requested, meter);
    if (!alternate || requested !== 0n) return digits;
    meter.checkpoint(1, 32 + (digits.length + 1) * 2);
    return digits + ".";
  }
  const significant = scientific ? requested + 1n : requested === 0n ? 1n : requested;
  // General format without # removes insignificant trailing zeros. Binary64's
  // entire exact coefficient fits in 1,075 digits, so never allocate the zeros
  // only to discard them, even when the user requests enormous precision.
  const renderedPrecision = !scientific && !alternate && significant > 1075n ? 1075n : significant;
  const bound = renderedPrecision + 330n;
  if (bound > 0xffffffffn) exhaustAllocation(meter);
  meter.checkpoint(1, 128 + Number(bound) * 8);
  const rounded = floatSignificantDigits(value, renderedPrecision, meter);
  let digits = rounded.digits;
  const exponent = rounded.exponent;
  if (!scientific && !alternate) {
    let end = digits.length;
    while (end > 1 && digits.charCodeAt(end - 1) === 48) { meter.checkpoint(); end--; }
    digits = digits.slice(0, end);
  }
  let result: string;
  if (scientific || exponent < -4 || BigInt(exponent) >= significant - (addDotZero ? 1n : 0n)) {
    const fraction = digits.slice(1);
    result = digits[0] + (fraction.length || alternate ? "." + fraction : "")
      + (upper ? "E" : "e") + (exponent < 0 ? "-" : "+") + Math.abs(exponent).toString().padStart(2, "0");
  } else if (exponent < 0) {
    result = "0." + "0".repeat(-exponent - 1) + digits;
  } else {
    const integral = exponent + 1;
    result = digits.length > integral ? digits.slice(0, integral) + "." + digits.slice(integral)
      : digits.padEnd(integral, "0") + (alternate ? "." : addDotZero ? ".0" : "");
  }
  meter.checkpoint();
  return result;
}
