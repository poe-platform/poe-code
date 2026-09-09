import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { floatPercentMagnitude } from "./float-percent-magnitude.js";
import type { BoundPercentFormatEvent } from "./percent-format-bind.js";

export type FloatPercentField = Pick<Extract<BoundPercentFormatEvent<unknown>, { kind: "conversion" }>, "code" | "flags" | "width" | "precision">;

/** Produce one owned ASCII numeric buffer, placing a sign before width zeros.
 * Unlike modern float formatting, percent formatting zero-pads infinities/NaNs.
 * Negative zero keeps its sign; NaN's sign bit is deliberately ignored. */
export function renderFloatPercentBuffer(value: number, field: FloatPercentField, storage: Uint8ArrayConstructor, meter: ExecutionMeter): Uint8Array;
export function renderFloatPercentBuffer(value: number, field: FloatPercentField, storage: Uint32ArrayConstructor, meter: ExecutionMeter): Uint32Array;
export function renderFloatPercentBuffer(value: number, field: FloatPercentField, storage: Uint8ArrayConstructor | Uint32ArrayConstructor, meter: ExecutionMeter): Uint8Array | Uint32Array {
  meter.checkpoint();
  const { code, flags, width, precision } = field;
  if (width < 0n || precision !== null && precision < 0n) throw new RangeError("field dimensions must be nonnegative");
  const magnitude = floatPercentMagnitude(value, code, precision, flags.alternate, meter);
  const negative = value < 0 || Object.is(value, -0);
  const sign = negative ? 45 : flags.sign ? 43 : flags.space ? 32 : 0;
  const core = BigInt(magnitude.length + (sign === 0 ? 0 : 1));
  const finalLength = width > core ? width : core;
  if (finalLength > 0xffffffffn) exhaustAllocation(meter);
  const length = Number(finalLength), padding = Number(finalLength - core);
  meter.checkpoint(0, length * storage.BYTES_PER_ELEMENT);
  const points = new storage(length);
  let offset = 0;
  if (!flags.left && !flags.zero) for (let i = 0; i < padding; i++) { meter.checkpoint(); points[offset++] = 32; }
  if (sign !== 0) { meter.checkpoint(); points[offset++] = sign; }
  if (flags.zero && !flags.left) for (let i = 0; i < padding; i++) { meter.checkpoint(); points[offset++] = 48; }
  for (let i = 0; i < magnitude.length; i++) { meter.checkpoint(); points[offset++] = magnitude.charCodeAt(i); }
  while (offset < length) { meter.checkpoint(); points[offset++] = 32; }
  return points;
}
