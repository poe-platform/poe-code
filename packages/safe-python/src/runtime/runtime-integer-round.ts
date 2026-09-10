import type { ExecutionMeter } from "./execution-budget.js";
import { integerBitMetric } from "./integer-bit-metric.js";
import { integerRound } from "./rounding.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Shared native rounding: argument conversion belongs to the caller, while
 * integer identity, owned payload normalization and arithmetic metering live here. */
export function roundRuntimeInteger(receiver: RuntimeValue, places: bigint | undefined, values: RuntimeValues, meter: ExecutionMeter): Extract<RuntimeValue, { kind: "int" }> {
  meter.checkpoint();
  if (receiver.kind === "int" && (places === undefined || places >= 0n)) return receiver;
  const payload = runtimeIntegerPayload(receiver);
  if (payload === undefined) throw Error("integer rounding requires integer storage");
  const integer = payload.kind === "int" ? payload.value : payload.value ? 1n : 0n;
  const bits = integerBitMetric(integer, "bit_length", meter);
  // Decimal inspection and bigint intermediates precede indivisible arithmetic.
  meter.checkpoint(1 + Math.ceil(bits / 64), 128 + bits * 4);
  return values.integer(integerRound(integer, places));
}
