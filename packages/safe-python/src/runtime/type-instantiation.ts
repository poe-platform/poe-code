import type { ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";

export interface TypeInstantiationContext<Value, Keywords = ReadonlyMap<string, Value>> {
  /** Resolve the requested type's allocator. Descriptor binding, static __new__
   * handling and native allocation checks belong to this adapter. A disabled or
   * noncallable slot must raise on invocation, not be reported as absent. */
  lookupNew(type: Value): ((type: Value, positional: readonly Value[], keywords: Keywords) => Value) | undefined;
  /** Actual runtime type and actual MRO relation, never __class__ attributes,
   * __instancecheck__ or __subclasscheck__. */
  typeOf(value: Value): Value;
  isSubtype(actual: Value, requested: Value): boolean;
  /** Resolve and bind the initializer on the result's actual type, after new
   * returns. Inherited methods and live mutations must remain observable. */
  lookupInit(instance: Value, actual: Value): ((positional: readonly Value[], keywords: Keywords) => Value) | undefined;
  isNone(value: Value): boolean;
  /** Name of the supplied actual type, without guest conversions. */
  typeName(value: Value): string;
}

/** Default type-call lifecycle after argument collection and metaclass __call__
 * selection. New may return an unrelated object, bypassing initialization. A
 * related result uses its actual type's initializer with the original arguments.
 * Failures never roll back allocator/initializer effects. Native special cases
 * such as one-argument type(), allocation/layout policies and recursion limits
 * remain with the surrounding call adapter. */
export function instantiateType<Value, Keywords = ReadonlyMap<string, Value>>(type: Value, positional: readonly Value[], keywords: Keywords, context: TypeInstantiationContext<Value, Keywords>, meter: ExecutionMeter): Value {
  meter.checkpoint();
  const allocate = context.lookupNew(type); meter.checkpoint();
  if (allocate === undefined) {
    const name = context.typeName(type); meter.checkpoint();
    meter.checkpoint(0, 128 + 2 * name.length);
    throw new PythonRuntimeError("TypeError", `cannot create '${name}' instances`);
  }
  const instance = allocate(type, positional, keywords); meter.checkpoint();
  const actual = context.typeOf(instance); meter.checkpoint();
  const related = context.isSubtype(actual, type); meter.checkpoint();
  if (!related) return instance;
  const initialize = context.lookupInit(instance, actual); meter.checkpoint();
  if (initialize !== undefined) {
    const result = initialize(positional, keywords); meter.checkpoint();
    const valid = context.isNone(result); meter.checkpoint();
    if (!valid) {
      const resultType = context.typeOf(result); meter.checkpoint();
      const name = context.typeName(resultType); meter.checkpoint();
      throw new PythonRuntimeError("TypeError", `__init__() should return None, not '${diagnosticTypeName(name, meter)}'`);
    }
  }
  return instance;
}
