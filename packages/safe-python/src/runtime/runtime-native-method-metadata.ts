import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { hasRuntimeInstanceAttributes, type RuntimeValue, type RuntimeValues, type TypeValue } from "./runtime-values.js";

export interface NativeMethodMetadataContext {
  attribute?(value: RuntimeValue, name: string): RuntimeValue;
  actualType?(value: RuntimeValue): TypeValue;
}

function qualifiedName(owner: TypeValue, name: string, source: "descriptor" | "method", values: RuntimeValues, meter: ExecutionMeter, context?: NativeMethodMetadataContext): Extract<RuntimeValue, { kind: "str" }> {
  const stem = context?.attribute === undefined ? owner.value.names.get("__qualname__", values, meter) : context.attribute(owner, "__qualname__");
  meter.checkpoint();
  if (stem.kind !== "str") throw new PythonRuntimeError("TypeError", source === "descriptor" ? "<descriptor>.__objclass__.__qualname__ is not a unicode object" : "<method>.__class__.__qualname__ is not a unicode object");
  return values.stringPoints(stem.value.concat(values.string(`.${name}`).value, meter));
}

/** Native descriptors cache their defining owner's qualified name. Bound
 * built-ins instead consult their receiver's current type on every read. */
export function readRuntimeNativeMethodMetadata(receiver: RuntimeValue, name: string, values: RuntimeValues, meter: ExecutionMeter, context?: NativeMethodMetadataContext): RuntimeValue | undefined {
  if (receiver.kind === "builtin_function_or_method" && receiver.binding !== undefined) {
    const binding = receiver.binding;
    if (name === "__name__") return values.string(binding.descriptor.value.name);
    if (name === "__self__") return binding.instance;
    if (name !== "__qualname__") return undefined;
    const self = binding.instance;
    let owner: TypeValue;
    if (self.kind === "type") owner = self;
    else if (hasRuntimeInstanceAttributes(self)) owner = self.type;
    else {
      if (context?.actualType === undefined) throw Error("native method qualified names require an actual type policy");
      owner = context.actualType(self); meter.checkpoint();
    }
    return qualifiedName(owner, binding.descriptor.value.name, "method", values, meter, context);
  }
  if (receiver.kind === "method-wrapper" && name === "__self__") return receiver.value.instance;
  const descriptor = receiver.kind === "method-wrapper" ? receiver.value.descriptor : receiver;
  if (descriptor.kind !== "method_descriptor" && descriptor.kind !== "classmethod_descriptor" && descriptor.kind !== "wrapper_descriptor" && descriptor.kind !== "getset_descriptor" && descriptor.kind !== "member_descriptor") return undefined;
  if (name === "__name__") return values.string(descriptor.value.name);
  if (name === "__objclass__") return descriptor.value.owner;
  if (name === "__qualname__") return values.descriptorQualifiedName(descriptor, () => qualifiedName(descriptor.value.owner, descriptor.value.name, "descriptor", values, meter, context));
  return undefined;
}
