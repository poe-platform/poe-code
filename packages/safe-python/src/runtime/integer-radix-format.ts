import { PythonRuntimeError } from "./error.js";
import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import type { FormatSpec } from "./format-spec.js";
import { integerDigits } from "./integer-digits.js";

/** Owned code-point buffer for parsed b/o/d/x/X presentations. Presentation
 * dispatch, character/locale/float modes and guest identity belong to callers.
 * Zero padding under '=' participates in digit grouping and can exceed width
 * by a separator; other alignment padding never participates in grouping. */
export function renderIntegerRadixFormat(value: bigint, field: FormatSpec, meter: ExecutionMeter, maxDecimalDigits = 4300): Uint32Array {
  meter.checkpoint(1, 256);
  let radix: 2 | 8 | 10 | 16;
  switch (field.type) {
    case 98: radix = 2; break;
    case 111: radix = 8; break;
    case 100: radix = 10; break;
    case 120: case 88: radix = 16; break;
    default: throw new RangeError("unsupported integer radix presentation");
  }
  if (field.precision !== null) throw new PythonRuntimeError("ValueError", "Precision not allowed in integer format specifier");
  if (field.noNegativeZero) throw new PythonRuntimeError("ValueError", "Negative zero coercion (z) not allowed in integer format specifier");
  const digits = integerDigits(value, radix, meter, maxDecimalDigits), negative = value < 0n;
  const start = negative ? 1 : 0, count = digits.length - start;
  const sign = negative ? 45 : field.sign === "+" ? 43 : field.sign === " " ? 32 : 0;
  const prefix = field.alternate && radix !== 10;
  const header = (sign === 0 ? 0 : 1) + (prefix ? 2 : 0);
  const width = field.width ?? 0n;
  if (width > 0xffffffffn) exhaustAllocation(meter);
  const group = field.groupSize, grouped = field.grouping !== null;
  let digitCount = count;
  if (field.align === "=" && field.fill === 48) {
    const minimum = Math.max(0, Number(width) - header);
    // Invert D + floor((D - 1) / group) >= minimum without scanning width.
    const required = grouped && minimum > 0 ? minimum - Math.floor((minimum - 1) / (group + 1)) : minimum;
    digitCount = Math.max(count, required);
  }
  const separators = grouped ? Math.floor((digitCount - 1) / group) : 0;
  const core = header + digitCount + separators;
  const length = Math.max(Number(width), core);
  if (length > 0xffffffff) exhaustAllocation(meter);
  meter.checkpoint(0, length * Uint32Array.BYTES_PER_ELEMENT);
  const output = new Uint32Array(length), padding = length - core;
  const left = field.align === ">" ? padding : field.align === "^" ? Math.floor(padding / 2) : 0;
  let offset = 0;
  while (offset < left) { meter.checkpoint(); output[offset++] = field.fill; }
  if (sign !== 0) { meter.checkpoint(); output[offset++] = sign; }
  if (prefix) {
    meter.checkpoint(); output[offset++] = 48;
    meter.checkpoint(); output[offset++] = field.type;
  }
  if (field.align === "=") for (let i = 0; i < padding; i++) { meter.checkpoint(); output[offset++] = field.fill; }
  for (let i = 0; i < digitCount; i++) {
    meter.checkpoint();
    if (grouped && i !== 0 && (digitCount - i) % group === 0) {
      meter.checkpoint(); output[offset++] = field.grouping === "," ? 44 : 95;
    }
    const source = i - (digitCount - count);
    const point = source < 0 ? 48 : digits.charCodeAt(start + source);
    output[offset++] = field.type === 88 && point >= 97 ? point - 32 : point;
  }
  while (offset < length) { meter.checkpoint(); output[offset++] = field.fill; }
  return output;
}
