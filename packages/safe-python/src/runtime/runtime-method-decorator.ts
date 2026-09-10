import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { MethodDecoratorValue, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Static methods return the payload itself. Class methods bind the effective
 * owner, not the defining ancestor, without chaining descriptor protocols into
 * the payload. An omitted owner uses intrinsic receiver ownership or the supplied
 * actual-type policy; ordinary __class__ attributes are never consulted. */
export function getRuntimeMethodDecorator(descriptor: MethodDecoratorValue, instance: RuntimeValue | null, owner: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, actualType?: (value: RuntimeValue) => TypeValue): RuntimeValue {
  meter.checkpoint();
  if ((instance === null || instance.kind === "none") && owner.kind === "none") throw new PythonRuntimeError("TypeError", "__get__(None, None) is invalid");
  if (descriptor.kind === "staticmethod") return descriptor.value;
  let effective = owner;
  if (owner.kind === "none") {
    if (instance === null || instance.kind === "none") throw Error("missing classmethod receiver");
    if (instance.kind === "instance") effective = instance.type;
    else if (instance.kind === "type") effective = instance.metaclass;
    else if ((instance.kind === "staticmethod" || instance.kind === "classmethod") && instance.type !== undefined) effective = instance.type;
    else {
      if (actualType === undefined) throw Error("classmethod binding requires an actual-type policy");
      effective = actualType(instance); meter.checkpoint();
    }
  }
  return values.boundMethod(descriptor.value, effective);
}
