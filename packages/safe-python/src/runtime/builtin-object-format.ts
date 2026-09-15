import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { objectFormat } from "./object-format.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import type { MethodDescriptorValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Base object formatting validates its specification, then delegates to str
 * without invoking the receiver's potentially overridden format method again. */
export function createObjectFormatDescriptor(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): MethodDescriptorValue {
  meter.checkpoint(0, 96);
  return values.methodDescriptor({ owner, name: "__format__", doc: "Default object formatter.\n\nReturn str(self) if format_spec is empty. Raise TypeError otherwise.", accepts: () => true,
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "object.__format__() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `object.__format__() takes exactly one argument (${positional.length} given)`);
      const context = invocation?.formatting ?? createRuntimeRepresentationContext(values, meter, { defaultRepr() { throw Error("object formatting requires a representation policy"); } });
      const spec = positional[0], storage = context.string(spec); meter.checkpoint();
      if (storage === undefined) {
        const type = spec.kind === "none" ? "None" : diagnosticTypeName(context.typeName(spec), meter, 50);
        throw new PythonRuntimeError("TypeError", `__format__() argument must be str, not ${type}`);
      }
      return objectFormat(receiver, storage, context, meter);
    }
  });
}
