import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { ClassMethodDescriptorValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Native terminal subclass hook, reached through normal class-method binding. */
export function createObjectInitSubclassDescriptor(values: RuntimeValues, meter: ExecutionMeter, objectType: TypeValue): ClassMethodDescriptorValue {
  meter.checkpoint(1, 96);
  return values.classMethodDescriptor({ owner: objectType, name: "__init_subclass__",
    accepts(receiver, meter) {
      if (receiver.kind !== "type") return false;
      for (const ancestor of receiver.value.mro) { meter.checkpoint(); if (ancestor === objectType.value) return true; }
      return false;
    },
    invoke(receiver, positional, keywords, meter) {
      if (receiver.kind !== "type") throw Error("subclass hook requires a class receiver");
      const hasKeywords = keywords.items.size !== 0;
      if (hasKeywords || positional.length !== 0) {
        let name = "";
        for (const point of receiver.value.names.get("__qualname__", values, meter).value) { meter.checkpoint(1, point > 0xffff ? 4 : 2); name += String.fromCodePoint(point); }
        meter.checkpoint(0, 128 + 2 * name.length);
        throw new PythonRuntimeError("TypeError", `${name}.__init_subclass__() takes no ${hasKeywords ? "keyword arguments" : `arguments (${positional.length} given)`}`);
      }
      meter.checkpoint(); return values.none;
    }
  });
}
