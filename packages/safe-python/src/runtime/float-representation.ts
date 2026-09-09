import type { ExecutionMeter } from "./execution-budget.js";

/** Shortest round-trip binary64 representation with Python's notation policy.
 * The host supplies shortest decimal digits; only their layout changes. Host
 * fixed notation may include insignificant integral zeros, which must not become
 * extra significant digits when Python selects scientific notation instead.
 */
export function floatRepresentation(value: number, meter: ExecutionMeter): string {
  // Binary64 shortest output and all parsing/layout temporaries are bounded.
  meter.checkpoint(128, 1024);
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value < 0 ? "-inf" : "inf";
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
  const raw = Math.abs(value).toString(10), marker = raw.indexOf("e");
  const mantissa = marker < 0 ? raw : raw.slice(0, marker);
  const dot = mantissa.indexOf(".");
  let exponent = (marker < 0 ? 0 : Number(raw.slice(marker + 1))) + (dot < 0 ? mantissa.length : dot) - 1;
  let digits = mantissa.replace(".", ""), start = 0, end = digits.length;
  while (digits.charCodeAt(start) === 48) { meter.checkpoint(); start++; exponent--; }
  while (end > start + 1 && digits.charCodeAt(end - 1) === 48) { meter.checkpoint(); end--; }
  digits = digits.slice(start, end);
  let output: string;
  if (exponent < -4 || exponent >= 16) {
    output = digits[0] + (digits.length > 1 ? "." + digits.slice(1) : "")
      + "e" + (exponent < 0 ? "-" : "+") + Math.abs(exponent).toString().padStart(2, "0");
  } else if (exponent < 0) {
    output = "0." + "0".repeat(-exponent - 1) + digits;
  } else {
    const integral = exponent + 1;
    output = digits.length > integral ? digits.slice(0, integral) + "." + digits.slice(integral) : digits.padEnd(integral, "0") + ".0";
  }
  meter.checkpoint();
  return value < 0 ? "-" + output : output;
}
