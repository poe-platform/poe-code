import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import { runtimeIterate } from "./runtime-iteration.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Explicit bound-class policy, including ordinary no-argument construction
 * and subclass setitem dispatch. Exact dict results use native storage directly.
 */
export interface DictionaryFromKeysContext {
  create(): RuntimeValue;
  set(target: RuntimeValue, key: RuntimeValue, value: RuntimeValue): void;
}

/** Exact dict.fromkeys by default, or an explicitly supplied class binding.
 * Construction precedes iterator acquisition; one default object is shared by
 * all entries. Only exact dictionaries use cached-hash source merging. Generic
 * iteration calls subclass setitem even for duplicates and keeps partial effects
 * when a later iterator/hash/set callback fails. Descriptor installation remains
 * part of the object dispatcher, not this capability factory.
 */
export function createDictionaryFromKeysBuiltin(values: RuntimeValues, keys: KeyOperations<RuntimeValue>, meter: ExecutionMeter, context?: DictionaryFromKeysContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "fromkeys",
    invoke(positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "dict.fromkeys() takes no keyword arguments");
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", "fromkeys expected at least 1 argument, got 0");
      if (positional.length > 2) throw new PythonRuntimeError("TypeError", `fromkeys expected at most 2 arguments, got ${positional.length}`);
      const source = positional[0], value = positional[1] ?? values.none;
      const result = context ? context.create() : values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
      meter.checkpoint();
      if (result.kind === "dict" && source.kind === "dict") {
        meter.checkpoint(0, 16);
        result.items.update(source.items, undefined, { value });
      } else {
        const iterator = runtimeIterate(source, values, meter);
        while (true) {
          meter.checkpoint();
          const item = iterator.next();
          meter.checkpoint();
          if (item.done) break;
          if (result.kind === "dict") runtimeDictionaryAccess(result, item.value, { kind: "set", value }, meter);
          else context!.set(result, item.value, value);
          meter.checkpoint();
        }
      }
      meter.checkpoint();
      return result;
    }
  });
}
