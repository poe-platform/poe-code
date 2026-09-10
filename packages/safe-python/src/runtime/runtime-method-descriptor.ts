import { PythonRuntimeError } from "./error.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { hasRuntimeInstanceAttributes, type BuiltinInvocationContext, type DictionaryValue, type NativeMethodDescriptorValue, type MethodWrapperValue, type WrapperDescriptorValue, type RuntimeValue, type RuntimeValues, type TypeValue } from "./runtime-values.js";

function checkReceiver(descriptor: NativeMethodDescriptorValue | WrapperDescriptorValue, instance: RuntimeValue, meter: ExecutionMeter, direct = false): void {
  meter.checkpoint();
  if (descriptor.kind === "classmethod_descriptor") {
    if (instance.kind === "type") {
      const accepted = descriptor.value.accepts(instance, meter); meter.checkpoint();
      if (accepted) return;
    }
    const name = diagnosticTypeName(instance.kind === "type" ? instance.value.name : hasRuntimeInstanceAttributes(instance) ? instance.type.value.name : instance.kind === "none" ? "NoneType" : instance.kind === "not-implemented" ? "NotImplementedType" : instance.kind, meter, 100);
    meter.checkpoint(0, 128 + 2 * (name.length + descriptor.value.name.length + descriptor.value.owner.value.name.length));
    if (instance.kind !== "type") throw new PythonRuntimeError("TypeError", `descriptor '${descriptor.value.name}' for type '${descriptor.value.owner.value.name}' needs a type, not a '${name}' as arg 2`);
    throw new PythonRuntimeError("TypeError", `descriptor '${descriptor.value.name}' requires a subtype of '${descriptor.value.owner.value.name}' but received '${name}'`);
  }
  const accepted = descriptor.value.accepts(instance, meter); meter.checkpoint();
  if (accepted) return;
  const name = diagnosticTypeName(instance.kind === "instance" ? instance.type.value.name : instance.kind === "type" ? instance.metaclass.value.name
    : instance.kind === "none" ? "NoneType" : instance.kind === "not-implemented" ? "NotImplementedType" : instance.kind, meter, 100);
  meter.checkpoint(0, 128 + 4 * (name.length + descriptor.value.name.length + descriptor.value.owner.value.name.length));
  if (direct && descriptor.kind === "wrapper_descriptor") throw new PythonRuntimeError("TypeError", `descriptor '${descriptor.value.name}' requires a '${descriptor.value.owner.value.name}' object but received a '${name}'`);
  throw new PythonRuntimeError("TypeError", `descriptor '${descriptor.value.name}' for '${descriptor.value.owner.value.name}' objects doesn't apply to a '${name}' object`);
}

/** Unbound native descriptor call, after normal call-site argument expansion. */
export function callRuntimeMethodDescriptor(descriptor: NativeMethodDescriptorValue | WrapperDescriptorValue | MethodWrapperValue, positional: readonly RuntimeValue[], keywords: DictionaryValue, meter: ExecutionMeter, context?: BuiltinInvocationContext): RuntimeValue {
  meter.checkpoint();
  if (descriptor.kind === "method-wrapper") {
    const result = descriptor.value.descriptor.value.invoke(descriptor.value.instance, positional, keywords, meter, context);
    meter.checkpoint(); return result;
  }
  if (positional.length === 0) throw new PythonRuntimeError("TypeError", descriptor.kind === "wrapper_descriptor" || descriptor.kind === "classmethod_descriptor"
    ? `descriptor '${descriptor.value.name}' of '${descriptor.value.owner.value.name}' object needs an argument`
    : `unbound method ${descriptor.value.owner.value.name}.${descriptor.value.name}() needs an argument`);
  checkReceiver(descriptor, positional[0], meter, true);
  if (descriptor.kind === "classmethod_descriptor") {
    const iterator = keywords.items.iterate(key => key);
    for (let item = iterator.next(); !item.done; item = iterator.next()) {
      meter.checkpoint();
      if (item.value.kind !== "str") throw new PythonRuntimeError("TypeError", "keywords must be strings");
    }
  }
  meter.checkpoint(0, 32 + 8 * (positional.length - 1));
  const result = descriptor.value.invoke(positional[0], positional.slice(1), keywords, meter, context);
  meter.checkpoint(); return result;
}

/** Intrinsic non-data __get__. Binding validates self but does not invoke the
 * native method. Bound calls retain the receiver and normal invocation context. */
export function getRuntimeMethodDescriptor(descriptor: NativeMethodDescriptorValue | WrapperDescriptorValue, instance: RuntimeValue | null, owner: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, typeOf?: (value: RuntimeValue) => TypeValue): RuntimeValue {
  meter.checkpoint();
  if (descriptor.kind === "classmethod_descriptor") {
    if (owner.kind !== "none") instance = owner;
    else {
      if (instance === null || instance.kind === "none") throw new PythonRuntimeError("TypeError", "__get__(None, None) is invalid");
      if (instance.kind === "type") instance = instance.metaclass;
      else if (hasRuntimeInstanceAttributes(instance)) instance = instance.type;
      else {
        if (typeOf === undefined) throw Error("native class method binding requires an actual type policy");
        instance = typeOf(instance); meter.checkpoint();
      }
    }
  } else if (instance === null || instance.kind === "none") {
    if (owner.kind === "none") throw new PythonRuntimeError("TypeError", "__get__(None, None) is invalid");
    return descriptor;
  }
  checkReceiver(descriptor, instance, meter);
  if (descriptor.kind === "wrapper_descriptor") return values.methodWrapper(descriptor, instance);
  meter.checkpoint(0, 96);
  return values.builtinFunction({ name: descriptor.value.name, keywordValidation: descriptor.value.boundKeywordValidation, invoke(positional, keywords, meter, context) {
    meter.checkpoint();
    const result = descriptor.value.invoke(instance, positional, keywords, meter, context);
    meter.checkpoint(); return result;
  } }, { descriptor, instance });
}
