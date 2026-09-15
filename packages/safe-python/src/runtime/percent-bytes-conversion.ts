import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ImmutableBytes } from "./immutable-bytes.js";

export interface PercentBytesContext<Value> {
  /** Pure bytes/subclass payload inspection; must not invoke __bytes__. */
  byteString(value: Value): ImmutableBytes | undefined;
  /** Metered, guest-code-free bytearray/subclass snapshot. */
  byteArray(value: Value): ImmutableBytes | undefined;
  /** Bound type-level __bytes__. Undefined means absent, not non-callable. */
  lookupBytes(value: Value): (() => Value) | undefined;
  /** Absent for non-exporters. Otherwise acquire, copy in C order and release
   * the buffer, including non-contiguous views; acquisition errors propagate. */
  bufferBytes(value: Value): ImmutableBytes | undefined;
  typeName(value: Value): string;
}

/** Bytes percent b/s conversion is not bytes(value): neither integer lengths
 * nor iterable byte indices are accepted. Native bytes/bytearrays bypass slots,
 * then __bytes__ takes precedence over buffer extraction. */
export function percentBytes<Value>(value: Value, context: PercentBytesContext<Value>, meter: ExecutionMeter): ImmutableBytes {
  meter.checkpoint();
  const direct = context.byteString(value); meter.checkpoint();
  if (direct !== undefined) return direct;
  const array = context.byteArray(value); meter.checkpoint();
  if (array !== undefined) return array;
  const method = context.lookupBytes(value); meter.checkpoint();
  if (method !== undefined) {
    const result = method(); meter.checkpoint();
    const storage = context.byteString(result); meter.checkpoint();
    if (storage !== undefined) return storage;
    const name = diagnosticTypeName(context.typeName(result), meter);
    throw new PythonRuntimeError("TypeError", `__bytes__ returned non-bytes (type ${name})`);
  }
  const buffer = context.bufferBytes(value); meter.checkpoint();
  if (buffer !== undefined) return buffer;
  const name = diagnosticTypeName(context.typeName(value), meter, 100);
  throw new PythonRuntimeError("TypeError", `%b requires a bytes-like object, or an object that implements __bytes__, not '${name}'`);
}
