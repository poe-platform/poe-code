import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import { collectIterator } from "./iterator-collection.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { ProtocolIterator, type IterationContext } from "./protocol-iterator.js";
import { nativeIteratorLengthHint } from "./native-iterator-length-hint.js";
import { runtimeGetItem } from "./runtime-subscription.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { BuiltinInvocationContext, DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Call keys once and materialize arbitrary key iterables, retaining live exact
 * list keys. Call expansion supplies a duplicate rejection policy; ordinary
 * updates overwrite and retrieve repeated keys anew. Keyword-name validation
 * and optional mapping detection belong to the caller. */
export function mergeRuntimeMapping(target: DictionaryValue, source: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, invocation: BuiltinInvocationContext | undefined, iteration: IterationContext<RuntimeValue> | undefined, duplicate?: (key: RuntimeValue) => never): void {
  if (invocation?.attribute === undefined) throw new PythonRuntimeError("AttributeError", "keys");
  const keysMethod = invocation.attribute(source, "keys"); meter.checkpoint();
  const keys = invocation.call(keysMethod, []); meter.checkpoint();
  let cursor: Iterator<RuntimeValue>;
  if (keys.kind === "list" || keys.kind === "tuple") cursor = runtimeIterate(keys, values, meter);
  else {
    try { cursor = runtimeIterate(keys, values, meter, iteration); }
    catch (error) {
      meter.checkpoint();
      if (!runtimeExceptionMatches(error,"TypeError",invocation)) throw error;
      const sourceName = diagnosticTypeName(invocation.typeName?.(source) ?? source.kind, meter, 200);
      const keysName = diagnosticTypeName(invocation.typeName?.(keys) ?? (keys.kind === "none" ? "NoneType" : keys.kind), meter, 200);
      meter.checkpoint(0, 128 + 2 * (sourceName.length + keysName.length));
      throw new PythonRuntimeError("TypeError", `${sourceName}.keys() returned a non-iterable (type ${keysName})`);
    }
    if (cursor instanceof ProtocolIterator) {
      const original = cursor; cursor = cursor.reacquire(); original.lengthHint(8n);
    } else nativeIteratorLengthHint(cursor, meter);
    cursor = collectIterator(cursor, meter)[Symbol.iterator]();
  }
  for (let item = cursor.next(); !item.done; item = cursor.next()) {
    meter.checkpoint();
    if (duplicate !== undefined && target.items.containsKey(item.value)) duplicate(item.value);
    const value = runtimeGetItem(source, item.value, values, meter, invocation); meter.checkpoint();
    target.items.set(item.value, value);
  }
  meter.checkpoint();
}
