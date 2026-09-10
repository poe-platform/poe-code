import type { ExecutionMeter } from "./execution-budget.js";
import { createRuntimeDictionaryMethod } from "./runtime-dictionary-method.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Stable dictionary read descriptors retain native storage and active key policies. */
export function installRuntimeDictionaryMethodDescriptors(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  meter.checkpoint(0, 128);
  for (const [name, doc] of [
    ["get", "Return the value for key if key is in the dictionary, else default."],
    ["copy", "Return a shallow copy of the dict."],
    ["keys", "Return a set-like object providing a view on the dict's keys."],
    ["values", "Return an object providing a view on the dict's values."],
    ["items", "Return a set-like object providing a view on the dict's items."],
    ["__reversed__", "Return a reverse iterator over the dict keys."]
  ] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.methodDescriptor({ owner, name, doc, accepts: receiver => receiver.kind === "dict",
      invoke(receiver, positional, keywords, meter, invocation) {
        if (receiver.kind !== "dict") throw Error("dictionary method requires dictionary storage");
        const method = createRuntimeDictionaryMethod(receiver, name, values, meter);
        return method.value.invoke(positional, keywords, meter, invocation);
      }
    }));
  }
}
