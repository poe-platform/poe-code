import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** type.__init__ validates calling shape, not the class-creation inputs. Building
 * or modifying a type belongs to type.__new__ and the class construction path. */
export function createTypeInitWrapper(values: RuntimeValues, meter: ExecutionMeter, typeType: TypeValue): WrapperDescriptorValue {
  meter.checkpoint(1, 96);
  return values.wrapperDescriptor({ owner: typeType, name: "__init__", accepts(instance, meter) {
    if (instance.kind !== "type") return false;
    for (const ancestor of instance.metaclass.value.mro) { meter.checkpoint(); if (ancestor === typeType.value) return true; }
    return false;
  }, invoke(_instance, positional, keywords, meter) {
    meter.checkpoint();
    if (positional.length !== 1 && positional.length !== 3) throw new PythonRuntimeError("TypeError", "type.__init__() takes 1 or 3 arguments");
    if (positional.length === 1 && keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "type.__init__() takes no keyword arguments");
    return values.none;
  } });
}
