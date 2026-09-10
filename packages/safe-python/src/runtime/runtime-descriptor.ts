import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import type { ClassAttribute, DescriptorSlots } from "./instance-attributes.js";
import type { BoundMethodValue, FunctionValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";
import { readRuntimeGetsetDescriptor, mutateRuntimeGetsetDescriptor } from "./runtime-getset-descriptor.js";
import { getRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";

export interface RuntimeDescriptorContext {
  /** Resolve slots on the value's type, never its instance dictionary. Exact
   * Python functions and native descriptors use intrinsic slots, bypassing this hook. */
  slots(value: RuntimeValue): DescriptorSlots<RuntimeValue, RuntimeValue, RuntimeValue> | undefined;
}

/** Function __get__ after argument binding. null denotes the class-access marker;
 * guest None has the same meaning. A non-None owner need not itself be a type.
 * The exposed wrapper's arity/keyword handling is a separate object-layer task.
 */
export function getRuntimeFunctionDescriptor(fn: FunctionValue, instance: RuntimeValue | null, owner: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter): FunctionValue | BoundMethodValue {
  meter.checkpoint();
  if (instance === null || instance.kind === "none") {
    if (owner.kind === "none") throw new PythonRuntimeError("TypeError", "__get__(None, None) is invalid");
    return fn;
  }
  return values.boundMethod(fn, instance);
}

/** Adapt a value already found by class-MRO lookup for the shared descriptor
 * precedence kernels. Preserve slot owners and captured value identity. MRO/type
 * storage, __getattribute__ overrides and __getattr__ fallback remain separate.
 */
export function resolveRuntimeClassAttribute(value: RuntimeValue, context: RuntimeDescriptorContext, values: RuntimeValues, meter: ExecutionMeter): ClassAttribute<RuntimeValue, RuntimeValue, RuntimeValue> {
  meter.checkpoint(1, value.kind === "function" || value.kind === "method_descriptor" || value.kind === "wrapper_descriptor" ? 96 : value.kind === "getset_descriptor" ? 160 : 32);
  const slots = value.kind === "function"
    ? Object.freeze({ get: (instance: RuntimeValue | null, owner: RuntimeValue) => getRuntimeFunctionDescriptor(value, instance, owner, values, meter) })
    : value.kind === "getset_descriptor" ? Object.freeze({
      get: (instance: RuntimeValue | null, owner: RuntimeValue) => readRuntimeGetsetDescriptor(value, instance, owner, meter),
      set: (instance: RuntimeValue, item: RuntimeValue) => mutateRuntimeGetsetDescriptor(value, instance, { kind: "set", value: item }, meter),
      delete: (instance: RuntimeValue) => mutateRuntimeGetsetDescriptor(value, instance, { kind: "delete" }, meter)
    })
    : value.kind === "method_descriptor" || value.kind === "wrapper_descriptor" ? Object.freeze({ get: (instance: RuntimeValue | null, owner: RuntimeValue) => getRuntimeMethodDescriptor(value, instance, owner, values, meter) })
    : context.slots(value);
  meter.checkpoint();
  return Object.freeze({ value, slots });
}
