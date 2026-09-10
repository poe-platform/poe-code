import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { updateRuntimeSet } from "./runtime-set.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Argument errors precede mutation. Acquiring or consuming the source occurs
 * after clearing, and failures retain any elements already inserted. */
export function createSetInitWrapper(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): WrapperDescriptorValue {
  meter.checkpoint(0, 96);
  return values.wrapperDescriptor({ owner, name: "__init__", doc: "Initialize self.  See help(type(self)) for accurate signature.", accepts: receiver => receiver.kind === "set",
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "set() takes no keyword arguments");
      if (positional.length > 1) throw new PythonRuntimeError("TypeError", `set expected at most 1 argument, got ${positional.length}`);
      if (receiver.kind !== "set") throw Error("set initialization requires mutable set storage");
      receiver.items.clear();
      if (positional[0] !== undefined) updateRuntimeSet(receiver, positional[0], values, meter, invocation?.iteration);
      return values.none;
    }
  });
}
