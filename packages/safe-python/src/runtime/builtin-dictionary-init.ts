import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { createRuntimeDictionaryMutationMethod } from "./runtime-dictionary-mutation-method.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Reinitialization merges into existing storage; positional effects precede
 * keyword-name validation, matching the native dictionary update convention. */
export function createDictionaryInitWrapper(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): WrapperDescriptorValue {
  meter.checkpoint(0, 96);
  return values.wrapperDescriptor({ owner, name: "__init__", doc: "Initialize self.  See help(type(self)) for accurate signature.", accepts: receiver => receiver.kind === "dict",
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (positional.length > 1) throw new PythonRuntimeError("TypeError", `dict expected at most 1 argument, got ${positional.length}`);
      if (receiver.kind !== "dict") throw Error("dictionary initialization requires dictionary storage");
      const update = createRuntimeDictionaryMutationMethod(receiver, "update", values, meter);
      return update.value.invoke(positional, keywords, meter, invocation);
    }
  });
}
