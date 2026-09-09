import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Exact bytes or an iterable of byte indices; unlike bytes(n), an integer is
 * not a zero-filled allocation request. Guest __bytes__/buffers remain separate. */
export function runtimeBytesInput(source: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter): ImmutableBytes {
  meter.checkpoint();
  if (source.kind === "bytes") return source.value;
  const type = source.kind === "none" ? "NoneType" : source.kind === "not-implemented" ? "NotImplementedType" : source.kind;
  if (source.kind === "str") throw new PythonRuntimeError("TypeError", `cannot convert '${type}' object to bytes`);
  let iterator: Iterator<RuntimeValue>;
  try { iterator = runtimeIterate(source, values, meter); }
  catch (error) {
    if (error instanceof PythonRuntimeError && error.name === "TypeError") throw new PythonRuntimeError("TypeError", `cannot convert '${type}' object to bytes`);
    throw error;
  }
  meter.checkpoint(0, 32);
  const items: number[] = [];
  while (true) {
    meter.checkpoint(); const step = iterator.next(); meter.checkpoint();
    if (step.done) break;
    const byte = runtimeIntegerIndex(step.value, meter);
    if (byte < 0n || byte > 255n) throw new PythonRuntimeError("ValueError", "bytes must be in range(0, 256)");
    meter.checkpoint(0, 8); items.push(Number(byte));
  }
  return ImmutableBytes.copyOf(items, meter);
}
