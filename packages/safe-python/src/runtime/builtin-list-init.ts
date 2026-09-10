import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeListPayload } from "./runtime-list-payload.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Initialization replaces existing contents after validating arguments. Guest
 * iteration observes the cleared list; failures retain its partial progress. */
export function createListInitWrapper(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): WrapperDescriptorValue {
  meter.checkpoint(0, 96);
  return values.wrapperDescriptor({ owner, name: "__init__", doc: "Initialize self.  See help(type(self)) for accurate signature.", accepts: receiver => runtimeListPayload(receiver) !== undefined,
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      const list = runtimeListPayload(receiver);
      if (list === undefined) throw Error("list initialization requires list storage");
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "list() takes no keyword arguments");
      if (positional.length > 1) throw new PythonRuntimeError("TypeError", `list expected at most 1 argument, got ${positional.length}`);
      list.items.clear();
      const source = positional[0];
      if (source !== undefined) {
        if (source.kind === "list") list.items.extend(source.items);
        else list.items.extendIterator(runtimeIterate(source, values, meter, invocation?.iteration, undefined, true));
      }
      return values.none;
    }
  });
}
