import type { DescriptorSlots } from "./instance-attributes.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import type { AttributeInstanceValue, BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Owned descriptor flags come from its actual type. Bind/call live special
 * methods only when a descriptor operation is performed, never during a flag
 * query. Assignment and deletion share the type's descriptor mutation slot. */
export function runtimeOwnedDescriptorSlots(value: AttributeInstanceValue, values: RuntimeValues, meter: ExecutionMeter, invocation: BuiltinInvocationContext, enter: () => () => void): DescriptorSlots<RuntimeValue, RuntimeValue, RuntimeValue> | undefined {
  const get = invocation.hasSpecial!(value, "__get__"), set = invocation.hasSpecial!(value, "__set__"), remove = invocation.hasSpecial!(value, "__delete__"); meter.checkpoint();
  if (!get && !set && !remove) return undefined;
  meter.checkpoint(0, 256);
  const invoke = (name: string, args: readonly RuntimeValue[]) => {
    const leave = enter();
    try {
      const hook = invocation.lookupSpecial!(value, name); meter.checkpoint();
      if (hook === undefined) throw new PythonRuntimeError("AttributeError", name);
      const result = invocation.call(hook, args); meter.checkpoint(); return result;
    } finally { leave(); }
  };
  return Object.freeze({
    get: get ? (instance: RuntimeValue | null, owner: RuntimeValue) => invoke("__get__", [instance ?? values.none, owner]) : undefined,
    set: set || remove ? (instance: RuntimeValue, item: RuntimeValue) => { invoke("__set__", [instance, item]); } : undefined,
    delete: set || remove ? (instance: RuntimeValue) => { invoke("__delete__", [instance]); } : undefined
  });
}
