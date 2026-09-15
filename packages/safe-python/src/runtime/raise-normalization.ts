import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

export interface RaiseNormalizationContext<Value> {
  typeOf(value: Value): Value;
  /** Ordinary subclass query: unlike except matching, virtual hooks apply. */
  isSubclass(type: Value, requested: Value): boolean;
  /** Invoke the requested class with the original exception as one argument. */
  call(type: Value, value: Value): Value;
  isInstance(value: Value): boolean;
  repr(value: Value): string;
  /** Internal tp_name, not guest class attribute lookup. */
  typeName(type: Value): string;
  isGuest(error: unknown): boolean;
  /** Internal note insertion, not a call to an overridable add_note method.
   * Concrete __notes__ storage/protocol operations and metering are adapter-owned.
   */
  addNote(error: unknown, note: string): void;
}

/** Normalize an already-validated exception instance from explicit raise.
 * A successful virtual subclass query preserves identity. Reconstruction may
 * return any exception instance and is not repeatedly normalized. Failures receive
 * best-effort diagnostic notes; fatal host/limit failures are never suppressed.
 * Implicit context attachment and traceback propagation follow this operation.
 */
export function normalizeRaisedException<Value>(
  requested: Value, value: Value, context: RaiseNormalizationContext<Value>, meter: ExecutionMeter
): Value {
  meter.checkpoint();
  if (context.isSubclass(context.typeOf(value), requested)) return value;
  try {
    meter.checkpoint();
    const result = context.call(requested, value);
    if (!context.isInstance(result)) {
      meter.checkpoint();
      const representation = context.repr(requested);
      throw new PythonRuntimeError("TypeError", `calling ${representation} should have returned an instance of BaseException, not ${context.typeName(context.typeOf(result))}`);
    }
    return result;
  } catch (error) {
    if (error instanceof ExecutionLimitError || !context.isGuest(error)) throw error;
    let argumentsRepr = "<unknown>";
    try {
      meter.checkpoint();
      argumentsRepr = context.repr(value);
    } catch (reprError) {
      if (reprError instanceof ExecutionLimitError || !context.isGuest(reprError)) throw reprError;
    }
    const note = `Normalization failed: type=${context.typeName(requested)} args=${argumentsRepr}`;
    try {
      meter.checkpoint();
      context.addNote(error, note);
    } catch (noteError) {
      if (noteError instanceof ExecutionLimitError || !context.isGuest(noteError)) throw noteError;
    }
    throw error;
  }
}
