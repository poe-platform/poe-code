import type { ExecutionMeter } from "./execution-budget.js";
import { integerDigits } from "./integer-digits.js";
import type { IntegerProgression } from "./integer-sequence.js";

/** Stored range bounds, not normalized contents or cardinality. */
export function rangeRepresentation(value: IntegerProgression, meter: ExecutionMeter): string {
  meter.checkpoint();
  const start = integerDigits(value.start, 10, meter), stop = integerDigits(value.stop, 10, meter);
  const step = value.step === 1n ? undefined : integerDigits(value.step, 10, meter);
  const length = 9 + start.length + stop.length + (step === undefined ? 0 : 2 + step.length);
  meter.checkpoint(1, 64 + length * 4);
  return `range(${start}, ${stop}${step === undefined ? "" : ", " + step})`;
}
