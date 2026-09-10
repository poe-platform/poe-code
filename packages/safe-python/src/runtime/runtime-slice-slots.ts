import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeNativeRepresentation } from "./runtime-native-representation-method.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Immutable slice components are native member descriptors, not properties. */
export function installRuntimeSliceSlots(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): void {
  for (const name of ["start", "stop", "step"] as const) {
    meter.checkpoint(0, 96);
    owner.value.namespace.items.set(values.string(name), values.memberDescriptor({ owner, name, accepts: receiver => receiver.kind === "slice",
      get(receiver, meter) {
        meter.checkpoint();
        if (receiver.kind !== "slice") throw Error("slice member requires slice storage");
        return receiver[name];
      }
    }));
  }
  owner.value.namespace.items.set(values.string("__repr__"), values.wrapperDescriptor({ owner, name: "__repr__", doc: "Return repr(self).", accepts: receiver => receiver.kind === "slice",
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "wrapper __repr__() takes no keyword arguments");
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      if (receiver.kind !== "slice") throw Error("slice repr requires slice storage");
      return runtimeNativeRepresentation(receiver, "__repr__", values, meter, invocation);
    }
  }));
}
