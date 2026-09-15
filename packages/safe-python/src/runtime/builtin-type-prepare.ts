import type { ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import type { ClassMethodDescriptorValue, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Native preparation deliberately ignores arguments and returns fresh storage.
 * Class-method binding supplies and validates the metaclass receiver. */
export function createTypePrepareDescriptor(values: RuntimeValues, meter: ExecutionMeter, keys: KeyOperations<RuntimeValue>, type: TypeValue): ClassMethodDescriptorValue {
  meter.checkpoint(1, 96);
  return values.classMethodDescriptor({ owner: type, name: "__prepare__",
    doc: "Create the namespace for the class statement",
    accepts(receiver, meter) {
      if (receiver.kind !== "type") return false;
      for (const ancestor of receiver.value.mro) { meter.checkpoint(); if (ancestor === type.value) return true; }
      return false;
    },
    invoke(_receiver, _positional, _keywords, meter) {
      meter.checkpoint();
      return values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter, runtimeDictionaryStorage));
    }
  });
}
