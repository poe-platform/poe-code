import { PythonRuntimeError } from "./error.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import { runtimeDictionaryAccess } from "./runtime-dictionary-access.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeMutateSubscription } from "./runtime-subscription.js";
import type { BuiltinFunctionValue, ClassMethodDescriptorValue, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** The canonical class method binds the actual requested class. Custom
 * constructors may return non-dictionary objects with item-assignment slots. */
export function createDictionaryFromKeysDescriptor(owner: TypeValue, values: RuntimeValues, keys: KeyOperations<RuntimeValue>, meter: ExecutionMeter): ClassMethodDescriptorValue {
  meter.checkpoint(0, 96);
  return values.classMethodDescriptor({ owner, name: "fromkeys", doc: "Create a new dictionary with keys from iterable and values set to value.",
    accepts(receiver, meter) {
      if (receiver.kind !== "type") return false;
      for (const ancestor of receiver.value.mro) { meter.checkpoint(); if (ancestor === owner.value) return true; }
      return false;
    },
    invoke(receiver, positional, keywords, meter, invocation) {
      if (receiver.kind !== "type") throw Error("dictionary fromkeys requires a bound class");
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", `${diagnosticTypeName(receiver.value.name, meter)}.fromkeys() takes no keyword arguments`);
      const method = createDictionaryFromKeysBuiltin(values, keys, meter, receiver === owner ? undefined : {
        create() {
          if (invocation === undefined) throw Error("dictionary subclass construction requires an invocation policy");
          return invocation.call(receiver, []);
        },
        set(target, key, value) {
          runtimeMutateSubscription(target, key, { kind: "set", value }, values, meter, invocation, invocation?.integerIndex);
        }
      });
      return method.value.invoke(positional, keywords, meter, invocation);
    }
  });
}

/** Explicit bound-class policy, including ordinary no-argument construction
 * and subclass setitem dispatch. Exact dict results use native storage directly.
 */
export interface DictionaryFromKeysContext {
  create(): RuntimeValue;
  set(target: RuntimeValue, key: RuntimeValue, value: RuntimeValue): void;
}

/** Exact dict.fromkeys by default, or an explicitly supplied class binding.
 * Construction precedes iterator acquisition; one default object is shared by
 * all entries. Exact dictionaries/sets use cached-hash source merging. Generic
 * iteration calls subclass setitem even for duplicates and keeps partial effects
 * when a later iterator/hash/set callback fails. Descriptor installation remains
 * part of the object dispatcher, not this capability factory.
 */
export function createDictionaryFromKeysBuiltin(values: RuntimeValues, keys: KeyOperations<RuntimeValue>, meter: ExecutionMeter, context?: DictionaryFromKeysContext): BuiltinFunctionValue {
  meter.checkpoint(1, 64);
  return values.builtinFunction({
    name: "fromkeys",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "dict.fromkeys() takes no keyword arguments");
      if (positional.length < 1) throw new PythonRuntimeError("TypeError", "fromkeys expected at least 1 argument, got 0");
      if (positional.length > 2) throw new PythonRuntimeError("TypeError", `fromkeys expected at most 2 arguments, got ${positional.length}`);
      const source = positional[0], value = positional[1] ?? values.none;
      const result = context ? context.create() : values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter, runtimeDictionaryStorage));
      meter.checkpoint();
      if (result.kind === "dict" && (source.kind === "dict" || source.kind === "set" || source.kind === "frozenset")) {
        meter.checkpoint(0, 16);
        result.items.update(source.items, undefined, { value });
      } else {
        const iterator = runtimeIterate(source, values, meter, invocation?.iteration);
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
