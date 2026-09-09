import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { integerDigits } from "./integer-digits.js";
import type { BoundPercentFormatEvent } from "./percent-format-bind.js";

/** Bound grammar data; operand-to-integer conversion happens before rendering. */
export type IntegerPercentField = Pick<Extract<BoundPercentFormatEvent<unknown>, { kind: "conversion" }>, "code" | "flags" | "width" | "precision">;

/** Internal owned-buffer producer. Precision and width share one output buffer;
 * signs and alternate prefixes precede width zeroes. Python keeps a zero digit
 * at precision zero and does not disable zero width padding for precision. */
export function renderIntegerPercentBuffer(value: bigint, field: IntegerPercentField, storage: Uint8ArrayConstructor, meter: ExecutionMeter, maxDecimalDigits?: number): Uint8Array;
export function renderIntegerPercentBuffer(value: bigint, field: IntegerPercentField, storage: Uint32ArrayConstructor, meter: ExecutionMeter, maxDecimalDigits?: number): Uint32Array;
export function renderIntegerPercentBuffer(value: bigint, field: IntegerPercentField, storage: Uint8ArrayConstructor | Uint32ArrayConstructor, meter: ExecutionMeter, maxDecimalDigits = 4300): Uint8Array | Uint32Array {
  meter.checkpoint();
  const { code, flags, width, precision } = field;
  if (width < 0n || (precision !== null && precision < 0n)) throw new RangeError("field dimensions must be nonnegative");
  let radix: 8 | 10 | 16;
  switch (code) {
    case 100: case 105: case 117: radix = 10; break;
    case 111: radix = 8; break;
    case 120: case 88: radix = 16; break;
    default: throw new RangeError("unsupported integer percent conversion");
  }
  const digits = integerDigits(value, radix, meter, maxDecimalDigits), negative = value < 0n;
  const start = negative ? 1 : 0, count = digits.length - start;
  const sign = negative ? 45 : flags.sign ? 43 : flags.space ? 32 : 0;
  const prefix = flags.alternate && radix !== 10;
  const paddedDigits = precision !== null && precision > BigInt(count) ? precision : BigInt(count);
  const core = paddedDigits + BigInt((sign === 0 ? 0 : 1) + (prefix ? 2 : 0));
  const finalLength = width > core ? width : core;
  if (finalLength > 0xffffffffn) exhaustAllocation(meter);
  const length = Number(finalLength), padding = Number(finalLength - core);
  const zeroes = Number(paddedDigits) - count + (flags.zero && !flags.left ? padding : 0);
  meter.checkpoint(0, length * storage.BYTES_PER_ELEMENT);
  const points = new storage(length);
  let offset = 0;
  if (!flags.left && !flags.zero) for (let index = 0; index < padding; index++) { meter.checkpoint(); points[offset++] = 32; }
  if (sign !== 0) { meter.checkpoint(); points[offset++] = sign; }
  if (prefix) {
    meter.checkpoint(); points[offset++] = 48;
    meter.checkpoint(); points[offset++] = radix === 8 ? 111 : code === 88 ? 88 : 120;
  }
  for (let index = 0; index < zeroes; index++) { meter.checkpoint(); points[offset++] = 48; }
  for (let index = start; index < digits.length; index++) {
    meter.checkpoint();
    const point = digits.charCodeAt(index);
    points[offset++] = code === 88 && point >= 97 ? point - 32 : point;
  }
  while (offset < length) { meter.checkpoint(); points[offset++] = 32; }
  return points;
}
