import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { IntrinsicDescriptorKind } from "./runtime-descriptor-method.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** Native descriptor representation reads live intrinsic metadata, never guest
 * attributes. Only functions include an execution-local identity address. */
export function createDescriptorReprWrapper(kind: IntrinsicDescriptorKind, owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter): WrapperDescriptorValue {
  meter.checkpoint(1, 96);
  return values.wrapperDescriptor({ owner, name: "__repr__", doc: "Return repr(self).", accepts: receiver => receiver.kind === kind,
    invoke(receiver, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "wrapper __repr__() takes no keyword arguments");
      if (positional.length !== 0) throw new PythonRuntimeError("TypeError", `expected 0 arguments, got ${positional.length}`);
      if (receiver.kind === "function") {
        const name = receiver.value.qualifiedName;
        if (name.kind !== "str") throw Error("function qualified name must be string storage");
        const identity = (invocation?.identity ?? values.identity).id(receiver); meter.checkpoint();
        const hex = identity.toString(16); meter.checkpoint(0, 64 + hex.length * 2);
        const parts = [values.string("<function ").value, name.value, values.string(` at 0x${hex}>`).value];
        return values.stringPoints(values.string("").value.join(parts, meter));
      }
      if (receiver.kind !== "method_descriptor" && receiver.kind !== "classmethod_descriptor" && receiver.kind !== "wrapper_descriptor" && receiver.kind !== "getset_descriptor" && receiver.kind !== "member_descriptor") throw Error("invalid descriptor representation receiver");
      const label = receiver.kind === "wrapper_descriptor" ? "slot wrapper" : receiver.kind === "getset_descriptor" ? "attribute" : receiver.kind === "member_descriptor" ? "member" : "method";
      const name = receiver.value.name, typeName = receiver.value.owner.value.diagnosticName;
      meter.checkpoint(0, 96 + 2 * (label.length + name.length + typeName.length));
      return values.string(`<${label} '${name}' of '${typeName}' objects>`);
    }
  });
}
