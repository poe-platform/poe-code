import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { runtimeIntegerIndex } from "./runtime-integer-index.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { RuntimeValue, RuntimeValues } from "./runtime-values.js";
import type { IntegerIndexContext } from "./index-protocol.js";
import type { ExpressionContext } from "./expression-evaluation.js";
import { ProtocolIterator } from "./protocol-iterator.js";
import type { PercentBytesContext } from "./percent-bytes-conversion.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { nativeIteratorLengthHint } from "./native-iterator-length-hint.js";

export type RuntimeBytesInputProtocol = Pick<PercentBytesContext<RuntimeValue>, "lookupBytes" | "byteString" | "typeName"> &
  Partial<Pick<PercentBytesContext<RuntimeValue>, "bufferBytes" | "byteArray">>;

export interface RuntimeBytesInputContext {
  readonly bytes?: RuntimeBytesInputProtocol;
  readonly integerIndex?: IntegerIndexContext<RuntimeValue>;
  readonly iterate?: ExpressionContext<RuntimeValue>["iterate"];
}

/** Exact bytes or an iterable of byte indices; unlike bytes(n), an integer is
 * not a zero-filled allocation request. Guest __bytes__ precedes buffer copying,
 * then iterable fallback. Buffer capabilities own acquisition/copy/release. */
export function runtimeBytesInput(source: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, context: RuntimeBytesInputContext = {}): ImmutableBytes {
  meter.checkpoint();
  if (source.kind === "bytes") return source.value;
  if (context.bytes !== undefined) {
    const method = context.bytes.lookupBytes(source);
    meter.checkpoint();
    if (method !== undefined) {
      const result = method(); meter.checkpoint();
      const storage = context.bytes.byteString(result); meter.checkpoint();
      if (storage !== undefined) return storage;
      throw new PythonRuntimeError("TypeError", `__bytes__ returned non-bytes (type ${diagnosticTypeName(context.bytes.typeName(result), meter)})`);
    }
    const buffer = context.bytes.bufferBytes?.(source);
    meter.checkpoint();
    if (buffer !== undefined) return buffer;
  }
  const type = source.kind === "none" ? "NoneType" : source.kind === "not-implemented" ? "NotImplementedType" : source.kind;
  if (source.kind === "str") throw new PythonRuntimeError("TypeError", `cannot convert '${type}' object to bytes`);
  let iterator: Iterator<RuntimeValue>;
  try { iterator = context.iterate === undefined ? runtimeIterate(source, values, meter) : context.iterate(source); }
  catch (error) {
    meter.checkpoint();
    if (error instanceof PythonRuntimeError && error.name === "TypeError") {
      const name = context.bytes === undefined ? type : diagnosticTypeName(context.bytes.typeName(source), meter);
      throw new PythonRuntimeError("TypeError", `cannot convert '${name}' object to bytes`);
    }
    throw error;
  }
  if (iterator instanceof ProtocolIterator) iterator.lengthHint(8n, source);
  else nativeIteratorLengthHint(iterator, meter);
  meter.checkpoint(0, 32);
  const items: number[] = [];
  while (true) {
    meter.checkpoint(); const step = iterator.next(); meter.checkpoint();
    if (step.done) break;
    const byte = runtimeIntegerIndex(step.value, meter, context.integerIndex);
    if (byte < 0n || byte > 255n) throw new PythonRuntimeError("ValueError", "bytes must be in range(0, 256)");
    meter.checkpoint(0, 8); items.push(Number(byte));
  }
  return ImmutableBytes.copyOf(items, meter);
}
