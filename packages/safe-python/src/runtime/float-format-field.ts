import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import type { FormatSpec } from "./format-spec.js";
import { floatFormatMagnitude } from "./float-format-magnitude.js";

/** One owned numeric field buffer. Integer grouping counts from the right;
 * fractional grouping counts from the decimal point, excluding any suffix.
 * Only sign-aware zero padding on actual digits participates in grouping. */
export function renderFloatFormatBuffer(value: number, field: FormatSpec, meter: ExecutionMeter): Uint32Array {
  meter.checkpoint(1, 256);
  const { magnitude, negative } = floatFormatMagnitude(value, field, meter);
  const sign = negative ? 45 : field.sign === "+" ? 43 : field.sign === " " ? 32 : 0;
  let integral = 0;
  while (integral < magnitude.length) {
    meter.checkpoint();
    const point = magnitude.charCodeAt(integral);
    if (point < 48 || point > 57) break;
    integral++;
  }
  const decimal = magnitude.charCodeAt(integral) === 46;
  const fractionStart = integral + (decimal ? 1 : 0);
  let fractionEnd = fractionStart;
  if (decimal) while (fractionEnd < magnitude.length) {
    meter.checkpoint();
    const point = magnitude.charCodeAt(fractionEnd);
    if (point < 48 || point > 57) break;
    fractionEnd++;
  }
  const fraction = fractionEnd - fractionStart;
  const fractionSeparators = field.fractionGrouping !== null && fraction > 0 ? Math.floor((fraction - 1) / 3) : 0;
  const remainder = magnitude.length - integral + fractionSeparators;
  const header = sign === 0 ? 0 : 1, width = field.width ?? 0n;
  if (width > 0xffffffffn) exhaustAllocation(meter);
  const grouped = field.grouping !== null && integral > 0;
  let digits = integral;
  if (integral > 0 && field.align === "=" && field.fill === 48) {
    const minimum = Math.max(0, Number(width) - header - remainder);
    digits = Math.max(integral, grouped && minimum > 0 ? minimum - Math.floor((minimum - 1) / 4) : minimum);
  }
  const separators = grouped ? Math.floor((digits - 1) / 3) : 0;
  const core = header + digits + separators + remainder, length = Math.max(core, Number(width));
  if (length > 0xffffffff) exhaustAllocation(meter);
  meter.checkpoint(0, length * Uint32Array.BYTES_PER_ELEMENT);
  const output = new Uint32Array(length), padding = length - core;
  const left = field.align === ">" ? padding : field.align === "^" ? Math.floor(padding / 2) : 0;
  let offset = 0;
  while (offset < left) { meter.checkpoint(); output[offset++] = field.fill; }
  if (sign !== 0) { meter.checkpoint(); output[offset++] = sign; }
  if (field.align === "=") for (let i = 0; i < padding; i++) { meter.checkpoint(); output[offset++] = field.fill; }
  for (let i = 0; i < digits; i++) {
    meter.checkpoint();
    if (grouped && i !== 0 && (digits - i) % 3 === 0) {
      meter.checkpoint(); output[offset++] = field.grouping === "," ? 44 : 95;
    }
    const source = i - (digits - integral);
    output[offset++] = source < 0 ? 48 : magnitude.charCodeAt(source);
  }
  for (let i = integral; i < magnitude.length; i++) {
    meter.checkpoint();
    if (field.fractionGrouping !== null && i > fractionStart && i < fractionEnd && (i - fractionStart) % 3 === 0) {
      meter.checkpoint(); output[offset++] = field.fractionGrouping === "," ? 44 : 95;
    }
    output[offset++] = magnitude.charCodeAt(i);
  }
  while (offset < length) { meter.checkpoint(); output[offset++] = field.fill; }
  return output;
}
