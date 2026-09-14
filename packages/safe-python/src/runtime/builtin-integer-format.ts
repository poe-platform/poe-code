import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { integerFormat } from "./integer-format.js";
import { NumericLocale } from "./numeric-locale.js";
import { representationObject } from "./representation-protocol.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import type { MethodDescriptorValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Explicit int formatting bypasses format overrides, but an empty spec still
 * invokes str on the original object. Nonempty specs inspect native storage. */
export function createIntegerFormatDescriptor(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): MethodDescriptorValue {
  meter.checkpoint(0, 96);
  return values.methodDescriptor({textSignature: "($self, format_spec, /)",  owner, name: "__format__", doc: "Convert to a string according to format_spec.", accepts: receiver => runtimeIntegerPayload(receiver) !== undefined,
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "int.__format__() takes no keyword arguments");
      if (positional.length !== 1) throw new PythonRuntimeError("TypeError", `int.__format__() takes exactly one argument (${positional.length} given)`);
      const context = invocation?.formatting ?? createRuntimeRepresentationContext(values, meter, { defaultRepr() { throw Error("integer formatting requires a representation policy"); } });
      const spec = positional[0], storage = context.string(spec); meter.checkpoint();
      if (storage === undefined) {
        const type = spec.kind === "none" ? "None" : diagnosticTypeName(context.typeName(spec), meter, 50);
        throw new PythonRuntimeError("TypeError", `__format__() argument must be str, not ${type}`);
      }
      if (storage.length === 0) return representationObject(receiver, "str", context, meter);
      const payload = runtimeIntegerPayload(receiver)!;
      const integer = payload.kind === "int" ? payload.value : payload.value ? 1n : 0n;
      const type = context.typeName(receiver); meter.checkpoint();
      const locale = () => invocation?.formatting?.numericLocale?.() ?? NumericLocale.portable(meter);
      return values.stringPoints(integerFormat(integer, storage, type, meter, undefined, locale), "canonical");
    }
  });
}
