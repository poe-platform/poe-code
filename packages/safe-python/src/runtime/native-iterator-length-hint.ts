import type { CompletionIterator } from "./iterator-completion.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

/** Validate trusted native cursor hints at consumer boundaries, without using
 * them to allocate or control iteration. Attribute access is outside the
 * call-time TypeError fallback, just as in the guest length-hint protocol. */
export function nativeIteratorLengthHint(iterator: CompletionIterator<unknown>, meter: ExecutionMeter, fallback = 8n): bigint {
  meter.checkpoint();
  const method = iterator.lengthHint; meter.checkpoint();
  if (method === undefined) return fallback;
  let hint: number | bigint | undefined;
  try { hint = method.call(iterator); }
  catch (error) {
    meter.checkpoint();
    if (error instanceof PythonRuntimeError && error.name === "TypeError") return fallback;
    throw error;
  }
  meter.checkpoint();
  if (hint === undefined) return fallback;
  const integer = BigInt(hint);
  if (BigInt.asIntN(64, integer) !== integer) throw new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t");
  if (integer < 0n) throw new PythonRuntimeError("ValueError", "__length_hint__() should return >= 0");
  return integer;
}
