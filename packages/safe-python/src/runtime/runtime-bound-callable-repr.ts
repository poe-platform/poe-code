import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { representationObject } from "./representation-protocol.js";
import { createRuntimeRepresentationContext } from "./runtime-representation.js";
import type { NativeBoundCallableKind } from "./runtime-native-comparison-method.js";
import type { RuntimeValue, RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Bound guest methods represent their receiver through its active repr slot.
 * Native callables instead display the actual receiver type and opaque ID. */
export function createBoundCallableReprWrapper(kind: NativeBoundCallableKind, owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): WrapperDescriptorValue {
  meter.checkpoint(1, 96);
  return values.wrapperDescriptor({ owner, name: "__repr__", doc: "Return repr(self).", accepts: receiver => receiver.kind === kind,
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "wrapper __repr__() takes no keyword arguments");
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      if (receiver.kind === "method") {
        const fn = receiver.value.function;
        let name: RuntimeValue | undefined;
        if (fn.kind === "function") name = fn.value.qualifiedName;
        else {
          if (invocation?.attribute === undefined) throw Error("method repr requires an attribute policy");
          for (const field of ["__qualname__", "__name__"]) {
            meter.checkpoint();
            try { name = invocation.attribute(fn, field); break; }
            catch (error) { if (!(error instanceof PythonRuntimeError && error.name === "AttributeError")) throw error; }
          }
        }
        const context = invocation?.formatting ?? createRuntimeRepresentationContext(values, meter, { defaultRepr() { throw Error("method repr requires a representation policy"); } });
        const self = representationObject(receiver.value.instance, "repr", context, meter), storage = context.string(self);
        if (storage === undefined) throw Error("validated method receiver repr lost string storage");
        meter.checkpoint(0, 64);
        const parts = [values.string("<bound method ").value, name?.kind === "str" ? name.value : values.string("?").value, values.string(" of ").value, storage, values.string(">").value];
        return values.stringPoints(values.string("").value.join(parts, meter));
      }
      if (receiver.kind === "builtin_function_or_method" && receiver.binding === undefined) {
        meter.checkpoint(0, 64 + receiver.value.name.length * 2);
        return values.string(`<built-in function ${receiver.value.name}>`);
      }
      if (receiver.kind !== "method-wrapper" && receiver.kind !== "builtin_function_or_method") throw Error("invalid bound callable representation receiver");
      const binding = receiver.kind === "method-wrapper" ? receiver.value : receiver.binding;
      if (binding === undefined || invocation?.actualType === undefined) throw Error("native callable repr requires binding and actual type policies");
      const type = invocation.actualType(binding.instance); meter.checkpoint();
      const identity = (invocation.identity ?? values.identity).id(binding.instance); meter.checkpoint();
      const hex = identity.toString(16), name = binding.descriptor.value.name, typeName = type.value.name;
      meter.checkpoint(0, 128 + 2 * (hex.length + name.length + typeName.length));
      return values.string(receiver.kind === "method-wrapper" ? `<method-wrapper '${name}' of ${typeName} object at 0x${hex}>`
        : `<built-in method ${name} of ${typeName} object at 0x${hex}>`);
    }
  });
}
