import type { ConstantValues } from "./constant-values.js";
import { PythonRuntimeError } from "./error.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ExpressionSet } from "./expression-evaluation.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { UnhashableRuntimeValueError } from "./runtime-hash.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeSetPayload } from "./runtime-set-payload.js";
import type { IterationContext } from "./protocol-iterator.js";
import type { BuiltinInvocationContext, DictionaryValue, FrozenSetValue, RuntimeValue, RuntimeValues, SetValue } from "./runtime-values.js";

export function runtimeSetAccess(set: SetValue | FrozenSetValue, key: RuntimeValue, operation: "contains"|"contains-exact", values: ConstantValues, meter: ExecutionMeter, invocation?: Pick<BuiltinInvocationContext, "isException">): boolean;
export function runtimeSetAccess(set: SetValue, key: RuntimeValue, operation: "add", values: ConstantValues, meter: ExecutionMeter, invocation?: Pick<BuiltinInvocationContext, "isException">): void;
export function runtimeSetAccess(set: SetValue, key: RuntimeValue, operation: "discard", values: ConstantValues, meter: ExecutionMeter, invocation?: Pick<BuiltinInvocationContext, "isException">): boolean;
/** Exact set key operations. Mutable-set lookup probes use equivalent frozen
 * hashes without allocating replacement keys; insertion remains unhashable.
 * contains-exact is the native PySet_Contains policy: no mutable-set coercion. */
export function runtimeSetAccess(set: SetValue | FrozenSetValue, key: RuntimeValue, operation: "contains" | "contains-exact" | "add" | "discard", values: ConstantValues, meter: ExecutionMeter, invocation?: Pick<BuiltinInvocationContext, "isException">): boolean | void {
  meter.checkpoint();
  try {
    if (operation === "contains") return set.items.containsKey(key, key.kind === "set" ? key.items.keySetHash() : undefined);
    if (operation === "contains-exact") return set.items.containsKey(key);
    if (operation === "discard") return set.items.delete(key, key.kind === "set" ? key.items.keySetHash() : undefined);
    set.items.set(key, values.none);
  } catch (error) {
    const probe = key.kind === "instance" ? runtimeSetPayload(key) : undefined;
    const typeError = runtimeExceptionMatches(error instanceof RuntimeHashError ? error.original : error, "TypeError", invocation);
    if (operation !== "add" && operation!=="contains-exact" && probe?.kind === "set" && typeError) {
      return operation === "contains" ? set.items.containsKey(probe, probe.items.keySetHash()) : set.items.delete(probe, probe.items.keySetHash());
    }
    if (!(error instanceof UnhashableRuntimeValueError) && !(error instanceof RuntimeHashError)) throw error;
    const type = error instanceof RuntimeHashError ? error.keyType : key.kind;
    throw new PythonRuntimeError("TypeError", `cannot use '${type}' as a set element (${error instanceof RuntimeHashError ? error.detail() : error.message})`);
  }
}

/** Exact set/dict sources retain cached hashes; general iterables stream and
 * retain prior insertions on failure. Set iteration order is not an API promise. */
export function updateRuntimeSet(target: SetValue, source: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, iteration?: IterationContext<RuntimeValue>): void {
  meter.checkpoint();
  const nativeSource = runtimeSetPayload(source);
  if (nativeSource !== undefined) target.items.mergeKeysInPlace(nativeSource.items, "|");
  else if (source.kind === "dict") {
    meter.checkpoint(0, 16);
    target.items.mergeKeysInPlace(source.items, "|", { value: values.none });
  } else {
    const iterator = runtimeIterate(source, values, meter, iteration);
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

/** Exact sets reuse cached hashes. Other difference-update sources stream and
 * retain completed removals; unlike remove/discard, iterated mutable-set keys
 * are not converted to equivalent frozen probes. */
export function subtractRuntimeSet(target: SetValue, source: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, iteration?: IterationContext<RuntimeValue>): void {
  meter.checkpoint();
  const nativeSource = runtimeSetPayload(source);
  if (nativeSource !== undefined) target.items.subtractKeysInPlace(nativeSource.items);
  else {
    const iterator = runtimeIterate(source, values, meter, iteration);
    while (true) {
      meter.checkpoint();
      const item = iterator.next();
      meter.checkpoint();
      if (item.done) break;
      try { target.items.delete(item.value); }
      catch (error) {
        if (!(error instanceof UnhashableRuntimeValueError) && !(error instanceof RuntimeHashError)) throw error;
        const type = error instanceof RuntimeHashError ? error.keyType : item.value.kind;
        throw new PythonRuntimeError("TypeError", `cannot use '${type}' as a set element (${error instanceof RuntimeHashError ? error.detail() : error.message})`);
      }
    }
  }
  meter.checkpoint();
}

/** Generic xor inputs are fully deduplicated before mutating the receiver.
 * Exact dictionaries/sets instead use their cached key hashes directly. */
export function symmetricDifferenceUpdateRuntimeSet(target: SetValue, source: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, iteration?: IterationContext<RuntimeValue>): void {
  meter.checkpoint();
  const nativeSource = runtimeSetPayload(source);
  if (nativeSource !== undefined) target.items.mergeKeysInPlace(nativeSource.items, "^");
  else if (source.kind === "dict") {
    meter.checkpoint(0, 16);
    target.items.mergeKeysInPlace(source.items, "^", { value: values.none });
  } else {
    const prepared = values.set(target.items.emptyCopy());
    updateRuntimeSet(prepared, source, values, meter, iteration);
    target.items.mergeKeysInPlace(prepared.items, "^");
  }
  meter.checkpoint();
}

export function beginRuntimeSet(initial: readonly RuntimeValue[], values: RuntimeValues, keys: KeyOperations<RuntimeValue>, meter: ExecutionMeter, iteration?: IterationContext<RuntimeValue>): ExpressionSet<RuntimeValue> {
  meter.checkpoint(1, 128);
  const result = values.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const builder: ExpressionSet<RuntimeValue> = {
    add: key => runtimeSetAccess(result, key, "add", values, meter),
    update: source => updateRuntimeSet(result, source, values, meter, iteration),
    finish() { meter.checkpoint(); return result; }
  };
  for (const key of initial) builder.add(key);
  return builder;
}

/** Exact set construction after class-call binding; subclass hooks are separate. */
export function constructRuntimeSet(positional: readonly RuntimeValue[], keywords: DictionaryValue, values: RuntimeValues, keys: KeyOperations<RuntimeValue>, meter: ExecutionMeter, iteration?: IterationContext<RuntimeValue>): SetValue {
  meter.checkpoint();
  if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "set() takes no keyword arguments");
  if (positional.length > 1) throw new PythonRuntimeError("TypeError", `set expected at most 1 argument, got ${positional.length}`);
  const result = values.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  if (positional.length === 1) updateRuntimeSet(result, positional[0], values, meter, iteration);
  meter.checkpoint();
  return result;
}
