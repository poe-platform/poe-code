import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Explicit base representation reads owned type metadata and opaque guest IDs.
 * It never invokes the receiver's repr or metaclass attribute overrides. */
export function createObjectReprWrapper(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): WrapperDescriptorValue {
  meter.checkpoint(1, 128);
  const moduleKey = values.string("__module__"), builtins = values.string("builtins");
  return values.wrapperDescriptor({ owner, name: "__repr__", doc: "Return repr(self).", accepts: () => true,
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "wrapper __repr__() takes no keyword arguments");
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      if (invocation?.actualType === undefined) throw Error("object repr requires an actual type policy");
      const type = invocation.actualType(receiver); meter.checkpoint();
      const module = type.value.namespace.items.lookup(moduleKey)?.value;
      const qualified = module?.kind === "str" && module.value.compare(builtins.value, meter) !== 0;
      const name = type.value.names.get(qualified ? "__qualname__" : "__name__", values, meter);
      const identity = (invocation.identity ?? values.identity).id(receiver); meter.checkpoint();
      const hex = identity.toString(16); meter.checkpoint(0, 32 + 2 * hex.length);
      const suffix = values.string(` object at 0x${hex}>`);
      const parts = qualified ? [values.string("<").value, module.value, values.string(".").value, name.value, suffix.value]
        : [values.string("<").value, name.value, suffix.value];
      meter.checkpoint(0, 32 + parts.length * 8);
      return values.stringPoints(values.string("").value.join(parts, meter));
    }
  });
}
