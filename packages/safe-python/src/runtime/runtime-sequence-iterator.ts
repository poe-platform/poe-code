import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import { ProtocolIterator } from "./protocol-iterator.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { nativeIteratorLengthHint } from "./native-iterator-length-hint.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Acquire the iterator used by sequence materializers. Only initial acquisition
 * TypeErrors receive the consumer's diagnostic. Reacquisition/hints run outside
 * that boundary; the original cursor supplies the hint even when redirected. */
export function runtimeSequenceIterator(source: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, errorMessage: string, iterate?: ExpressionContext<RuntimeValue>["iterate"]): Iterator<RuntimeValue> {
  let iterator: Iterator<RuntimeValue>;
  try { iterator = iterate === undefined ? runtimeIterate(source, values, meter) : iterate(source); }
  catch (error) {
    if (error instanceof PythonRuntimeError && error.name === "TypeError") throw new PythonRuntimeError("TypeError", errorMessage);
    throw error;
  }
  meter.checkpoint();
  if (iterator instanceof ProtocolIterator) {
    const original = iterator;
    iterator = original.reacquire();
    original.lengthHint(8n);
  } else nativeIteratorLengthHint(iterator, meter);
  return iterator;
}
