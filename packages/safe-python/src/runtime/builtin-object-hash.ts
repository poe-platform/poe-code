import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Explicit object hashing always uses identity, even for unhashable native
 * values or classes overriding __hash__. Never reenter general hash dispatch. */
export function createObjectHashWrapper(values: RuntimeValues, meter: ExecutionMeter, objectType: TypeValue): WrapperDescriptorValue {
  meter.checkpoint(1, 96);
  return values.wrapperDescriptor({ owner: objectType, name: "__hash__", doc: "Return hash(self).", accepts: () => true,
    invoke(instance, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "wrapper __hash__() takes no keyword arguments");
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      if (invocation?.identityHash === undefined) throw Error("object hashing requires an identity hash policy");
      const result = invocation.identityHash(instance); meter.checkpoint();
      return values.integer(result);
    }
  });
}
