import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Explicit object.__str__ delegates to the actual repr slot, not str. Its raw
 * result is intentionally unvalidated: consuming str/format protocols validate. */
export function createObjectStrWrapper(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): WrapperDescriptorValue {
  meter.checkpoint(1, 96);
  return values.wrapperDescriptor({ owner, name: "__str__", doc: "Return str(self).", accepts: () => true,
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "wrapper __str__() takes no keyword arguments");
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      const context = invocation?.formatting ?? createRuntimeRepresentationContext(values, meter, { defaultRepr() { throw Error("object str requires a representation policy"); } });
      const repr = context.lookupRepr(receiver); meter.checkpoint();
      return repr === undefined ? context.defaultRepr(receiver) : repr();
    }
  });
}
