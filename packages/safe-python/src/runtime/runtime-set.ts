import type { ConstantValues } from "./constant-values.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ExpressionSet } from "./expression-evaluation.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { UnhashableRuntimeValueError } from "./runtime-hash.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { DictionaryValue, FrozenSetValue, RuntimeValue, RuntimeValues, SetValue } from "./runtime-values.js";

export function runtimeSetAccess(set: SetValue | FrozenSetValue, key: RuntimeValue, operation: "contains", values: ConstantValues, meter: ExecutionMeter): boolean;
export function runtimeSetAccess(set: SetValue, key: RuntimeValue, operation: "add", values: ConstantValues, meter: ExecutionMeter): void;
export function runtimeSetAccess(set: SetValue, key: RuntimeValue, operation: "discard", values: ConstantValues, meter: ExecutionMeter): boolean;
/** Exact set key operations. Mutable-set lookup probes use equivalent frozen
 * hashes without allocating replacement keys; insertion remains unhashable. */
export function runtimeSetAccess(set: SetValue | FrozenSetValue, key: RuntimeValue, operation: "contains" | "add" | "discard", values: ConstantValues, meter: ExecutionMeter): boolean | void {
  meter.checkpoint();
  try {
    if (operation === "contains") return set.items.containsKey(key, key.kind === "set" ? key.items.keySetHash() : undefined);
    if (operation === "discard") return set.items.delete(key, key.kind === "set" ? key.items.keySetHash() : undefined);
    set.items.set(key, values.none);
  } catch (error) {
    if (!(error instanceof UnhashableRuntimeValueError)) throw error;
    throw new PythonRuntimeError("TypeError", `cannot use '${key.kind}' as a set element (${error.message})`);
  }
}

/** Exact set/dict sources retain cached hashes; general iterables stream and
 * retain prior insertions on failure. Set iteration order is not an API promise. */
export function updateRuntimeSet(target: SetValue, source: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint();
  if (source.kind === "set" || source.kind === "frozenset") target.items.mergeKeysInPlace(source.items, "|");
  else if (source.kind === "dict") {
    meter.checkpoint(0, 16);
    target.items.mergeKeysInPlace(source.items, "|", { value: values.none });
  } else {
    const iterator = runtimeIterate(source, values, meter);
    while (true) {
      meter.checkpoint();
      const item = iterator.next();
      meter.checkpoint();
      if (item.done) break;
      runtimeSetAccess(target, item.value, "add", values, meter);
    }
  }
  meter.checkpoint();
}

export function beginRuntimeSet(initial: readonly RuntimeValue[], values: RuntimeValues, keys: KeyOperations<RuntimeValue>, meter: ExecutionMeter): ExpressionSet<RuntimeValue> {
  meter.checkpoint(1, 128);
  const result = values.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const builder: ExpressionSet<RuntimeValue> = {
    add: key => runtimeSetAccess(result, key, "add", values, meter),
    update: source => updateRuntimeSet(result, source, values, meter),
    finish() { meter.checkpoint(); return result; }
  };
  for (const key of initial) builder.add(key);
  return builder;
}

/** Exact set construction after class-call binding; subclass hooks are separate. */
export function constructRuntimeSet(positional: readonly RuntimeValue[], keywords: DictionaryValue, values: RuntimeValues, keys: KeyOperations<RuntimeValue>, meter: ExecutionMeter): SetValue {
  meter.checkpoint();
  if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "set() takes no keyword arguments");
  if (positional.length > 1) throw new PythonRuntimeError("TypeError", `set expected at most 1 argument, got ${positional.length}`);
  const result = values.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  if (positional.length === 1) updateRuntimeSet(result, positional[0], values, meter);
  meter.checkpoint();
  return result;
}
