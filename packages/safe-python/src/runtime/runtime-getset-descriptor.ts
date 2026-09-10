import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { hasRuntimeInstanceAttributes, type BuiltinInvocationContext, type GetsetDescriptorValue, type MemberDescriptorValue, type RuntimeValue } from "./runtime-values.js";

function checkReceiver(descriptor: GetsetDescriptorValue | MemberDescriptorValue, instance: RuntimeValue, meter: ExecutionMeter): void {
  meter.checkpoint();
  const accepted = descriptor.value.accepts(instance, meter);
  meter.checkpoint();
  if (accepted) return;
  const name = hasRuntimeInstanceAttributes(instance) ? instance.type.value.name : instance.kind === "type" ? instance.metaclass.value.name
    : instance.kind === "none" ? "NoneType" : instance.kind === "not-implemented" ? "NotImplementedType" : instance.kind;
  throw new PythonRuntimeError("TypeError", `descriptor '${descriptor.value.name}' for '${descriptor.value.owner.value.name}' objects doesn't apply to a '${name}' object`);
}

/** Intrinsic getset/member __get__ after argument binding; class access returns
 * the descriptor. Both native data-descriptor families share applicability. */
export function readRuntimeGetsetDescriptor(descriptor: GetsetDescriptorValue | MemberDescriptorValue, instance: RuntimeValue | null, owner: RuntimeValue, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): RuntimeValue {
  meter.checkpoint();
  if (instance === null || instance.kind === "none") {
    if (owner.kind === "none") throw new PythonRuntimeError("TypeError", "__get__(None, None) is invalid");
    return descriptor;
  }
  checkReceiver(descriptor, instance, meter);
  const result = descriptor.value.get(instance, meter, invocation);
  meter.checkpoint();
  return result;
}

/** Applicability precedes read-only diagnostics; successful callbacks retain
 * effects even if a later resource checkpoint terminates execution. */
export function mutateRuntimeGetsetDescriptor(descriptor: GetsetDescriptorValue | MemberDescriptorValue, instance: RuntimeValue,
  change: { readonly kind: "set"; readonly value: RuntimeValue } | { readonly kind: "delete" }, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): void {
  checkReceiver(descriptor, instance, meter);
  const capability = descriptor.value;
  if (change.kind === "set" && capability.set !== undefined) capability.set(instance, change.value, meter, invocation);
  else if (change.kind === "delete" && capability.delete !== undefined) capability.delete(instance, meter, invocation);
  else throw new PythonRuntimeError("AttributeError", descriptor.kind === "member_descriptor" ? "readonly attribute" : `attribute '${capability.name}' of '${capability.owner.value.name}' objects is not writable`);
  meter.checkpoint();
}
