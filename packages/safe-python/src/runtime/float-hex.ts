import type { ExecutionMeter } from "./execution-budget.js";

/** Decode binary64 fields directly; no decimal conversion or rounding. */
export function floatHex(value: number, meter: ExecutionMeter): string {
  meter.checkpoint();
  if (Number.isNaN(value)) return "nan";
  if (value === Infinity) return "inf";
  if (value === -Infinity) return "-inf";
  const sign = value < 0 || Object.is(value, -0) ? "-" : "";
  // Bounded buffer/view, bit-field intermediates and short formatting strings.
  meter.checkpoint(1, 512);
  if (value === 0) return `${sign}0x0.0p+0`;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0), storedExponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = (bits & ((1n << 52n) - 1n)).toString(16).padStart(13, "0");
  const exponent = storedExponent === 0 ? -1022 : storedExponent - 1023;
  return `${sign}0x${storedExponent === 0 ? "0" : "1"}.${fraction}p${exponent >= 0 ? "+" : ""}${exponent}`;
}
