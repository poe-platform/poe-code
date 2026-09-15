import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Native type representation reads owned metadata, bypassing metaclass attribute
 * overrides and descriptors stored as __module__. Text is not repr-escaped. */
export function createTypeReprWrapper(values: RuntimeValues, meter: ExecutionMeter, type: TypeValue): WrapperDescriptorValue {
  meter.checkpoint(1, 128);
  const moduleKey = values.string("__module__"), builtins = values.string("builtins"), prefix = values.string("<class '"), suffix = values.string("'>"), dot = values.string(".");
  return values.wrapperDescriptor({ owner: type, name: "__repr__", doc: "Return repr(self).",
    accepts(instance, meter) {
      if (instance.kind !== "type") return false;
      for (const ancestor of instance.metaclass.value.mro) { meter.checkpoint(); if (ancestor === type.value) return true; }
      return false;
    },
    invoke(instance, positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "wrapper __repr__() takes no keyword arguments");
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      if (instance.kind !== "type") throw Error("type representation requires a type record");
      if(instance.immutable && instance.value.nativeName!==undefined){
        meter.checkpoint(0,32+2*instance.value.nativeName.length);
        return values.string(`<class '${instance.value.nativeName}'>`);
      }
      const module = instance.value.namespace.items.lookup(moduleKey)?.value;
      const qualified = module?.kind === "str" && module.value.compare(builtins.value, meter) !== 0;
      const name = instance.value.names.get(qualified ? "__qualname__" : "__name__", values, meter);
      const parts = qualified
        ? [prefix.value, module.value, dot.value, name.value, suffix.value] : [prefix.value, name.value, suffix.value];
      meter.checkpoint(0, 32 + 8 * parts.length);
      return values.stringPoints(values.string("").value.join(parts, meter));
    }
  });
}
