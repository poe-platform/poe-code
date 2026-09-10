import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeListPayload } from "./runtime-list-payload.js";
import { runtimeNativeRepresentation } from "./runtime-native-representation-method.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Explicit base representation bypasses only the receiver's override. Nested
 * elements use active guest repr and the execution-owned recursion guard. */
export function createListReprWrapper(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): WrapperDescriptorValue {
  meter.checkpoint(0, 96);
  return values.wrapperDescriptor({ owner, name: "__repr__", doc: "Return repr(self).", accepts: receiver => runtimeListPayload(receiver) !== undefined,
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "wrapper __repr__() takes no keyword arguments");
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      if (invocation?.nativeListRepr !== undefined) return invocation.nativeListRepr(receiver);
      const list = runtimeListPayload(receiver);
      if (list === undefined) throw Error("list representation requires list storage");
      return runtimeNativeRepresentation(list, "__repr__", values, meter);
    }
  });
}
