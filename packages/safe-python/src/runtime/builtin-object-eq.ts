import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Explicit base equality recognizes identity only. Distinct values decline
 * instead of returning False, leaving reflection to the enclosing dispatcher. */
export function createObjectEqWrapper(values: RuntimeValues, meter: ExecutionMeter, objectType: TypeValue): WrapperDescriptorValue {
  meter.checkpoint(1, 96);
  return values.wrapperDescriptor({ owner: objectType, name: "__eq__", doc: "Return self==value.", accepts: () => true,
    invoke(instance, positional, keywords, meter) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "wrapper __eq__() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
      return instance === positional[0] ? values.true : values.notImplemented;
    }
  });
}
