import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { updateRuntimeSet } from "./runtime-set.js";
import { isRuntimeSet, type BuiltinFunctionValue, type FrozenSetValue, type RuntimeValue, type RuntimeValues, type SetValue } from "./runtime-values.js";

/** Build all stages privately; callers decide whether to publish a new value or
 * replace a mutable receiver. Even empty intermediate results process later
 * sources, and generic inputs retain their short-circuited iterator tails. */
export function intersectRuntimeSets(receiver: SetValue | FrozenSetValue, sources: readonly RuntimeValue[], values: RuntimeValues, meter: ExecutionMeter): OrderedKeyMap<RuntimeValue, RuntimeValue> {
  meter.checkpoint();
  if (sources.length === 0) return receiver.items.copy();
  let result = receiver.items;
  for (const source of sources) {
    meter.checkpoint(1, 32);
    result = isRuntimeSet(source) ? result.intersectKeys(source.items) : result.intersectKeysFrom(() => runtimeIterate(source, values, meter), values.none);
  }
  meter.checkpoint();
  return result;
}

/** Explicit exact-set/frozen-set algebra binding. Result kinds follow the
 * receiver; neither method mutates it or closes input iterators on failure. */
export function createRuntimeSetAlgebraMethod(receiver: SetValue | FrozenSetValue, name: "union" | "intersection", values: RuntimeValues, meter: ExecutionMeter): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name,
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${receiver.kind}.${name}() takes no keyword arguments`);
      if (name === "intersection") {
        const items = intersectRuntimeSets(receiver, positional, values, meter);
        return receiver.kind === "set" ? values.set(items) : values.frozenSet(items);
      }
      const result = values.set(receiver.items.copy());
      for (const source of positional) {
        meter.checkpoint();
        if (source !== receiver) updateRuntimeSet(result, source, values, meter);
      }
      return receiver.kind === "set" ? result : values.frozenSet(result.items);
    }
  });
}
