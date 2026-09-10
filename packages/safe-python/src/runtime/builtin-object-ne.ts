import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeTruth } from "./runtime-truth.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Default inequality delegates to the receiver's equality slot, not the full
 * == expression. NotImplemented is returned without a truth conversion. */
export function createObjectNeWrapper(values: RuntimeValues, meter: ExecutionMeter, objectType: TypeValue): WrapperDescriptorValue {
  meter.checkpoint(1, 96);
  return values.wrapperDescriptor({ owner: objectType, name: "__ne__", doc: "Return self!=value.", accepts: () => true,
    invoke(instance, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "wrapper __ne__() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `expected 1 argument, got ${positional.length}`);
      if (invocation?.compareSlot === undefined) throw Error("object inequality requires receiver comparison dispatch");
      const result = invocation.compareSlot("==", instance, positional[0]); meter.checkpoint();
      if (result === values.notImplemented) return result;
      const truth = invocation.truth === undefined ? runtimeTruth(result, meter) : invocation.truth(result);
      meter.checkpoint(); return values.boolean(!truth);
    }
  });
}
