import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { FormatSpec } from "./format-spec.js";
import { floatPercentMagnitude } from "./float-percent-magnitude.js";
import { floatRepresentation } from "./float-representation.js";

/** Rounded unsigned modern float text plus its post-rounding sign. Width,
 * grouping and locale presentation are separate layout responsibilities.
 * Complex components disable omitted-type addDotZero spelling. */
export function floatFormatMagnitude(value: number, field: Pick<FormatSpec, "type" | "precision" | "alternate" | "noNegativeZero">, meter: ExecutionMeter, addDotZero = true): Readonly<{ magnitude: string; negative: boolean }> {
  meter.checkpoint(1, 128);
  const { type, precision, alternate } = field;
  if (precision !== null && precision > 2147483647n) throw new PythonRuntimeError("ValueError", "precision too big");
  if (precision !== null && precision < 0n) throw new RangeError("precision must be nonnegative");
  if (type !== 0 && type !== 37 && type !== 101 && type !== 69 && type !== 102 && type !== 70 && type !== 103 && type !== 71) throw new RangeError("unsupported float presentation");
  const scaled = type === 37 ? value * 100 : value;
  let magnitude: string;
  if (type === 0 && precision === null) {
    magnitude = floatRepresentation(Math.abs(scaled), meter);
    if (!addDotZero && magnitude.endsWith(".0")) magnitude = magnitude.slice(0, alternate ? -1 : -2);
    if (alternate && Number.isFinite(scaled) && !magnitude.includes(".")) {
      const exponent = magnitude.indexOf("e");
      meter.checkpoint(1, 32 + (magnitude.length + 1) * 2);
      magnitude = exponent < 0 ? magnitude + "." : magnitude.slice(0, exponent) + "." + magnitude.slice(exponent);
    }
  } else {
    magnitude = floatPercentMagnitude(Math.abs(scaled), type === 0 ? 103 : type === 37 ? 102 : type, precision, alternate, meter, type === 0 && addDotZero);
  }
  let negative = scaled < 0 || Object.is(scaled, -0);
  if (negative && field.noNegativeZero && Number.isFinite(scaled)) {
    let zero = true;
    for (let i = 0; i < magnitude.length; i++) {
      meter.checkpoint();
      const point = magnitude.charCodeAt(i);
      if (point === 101 || point === 69) break;
      if (point !== 48 && point !== 46) { zero = false; break; }
    }
    if (zero) negative = false;
  }
  if (type === 37) {
    meter.checkpoint(1, 32 + (magnitude.length + 1) * 2);
    magnitude += "%";
  }
  return Object.freeze({ magnitude, negative });
}
