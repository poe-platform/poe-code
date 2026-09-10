import type { ExpressionCall } from "./call-arguments.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { instantiateType } from "./type-instantiation.js";
import { lookupRuntimeSpecialMethod, runtimeActualType, type RuntimeSpecialMethodContext } from "./runtime-special-method.js";
import { runtimeTypeAttribute } from "./runtime-type-attributes.js";
import { lookupMroAttribute } from "./class-attributes.js";
import { PythonRuntimeError } from "./error.js";
import type { DictionaryValue, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Runtime type calls use actual metaclass MRO dispatch, then the default
 * allocation/init lifecycle. Native allocation, heap layout
 * validation and default object methods remain bootstrap responsibilities.
 * Default mode implements explicit type.__call__, bypassing metaclass dispatch. */
export function callRuntimeType(type: TypeValue, positional: readonly RuntimeValue[], keywords: DictionaryValue, special: RuntimeSpecialMethodContext, values: RuntimeValues, meter: ExecutionMeter, beginCall: (callee: RuntimeValue) => ExpressionCall<RuntimeValue>, attribute?: (receiver: RuntimeValue, name: string) => RuntimeValue, mode: "dispatch" | "default" = "dispatch"): RuntimeValue {
  meter.checkpoint(1, 512);
  const invoke = (callee: RuntimeValue, args: readonly RuntimeValue[], named?: DictionaryValue): RuntimeValue => {
    const call = beginCall(callee); meter.checkpoint();
    for (const item of args) { meter.checkpoint(); call.positional(item); }
    if (named !== undefined) call.mapping(named);
    meter.checkpoint();
    const result = call.invoke(); meter.checkpoint(); return result;
  };
  if (mode === "dispatch") {
    const override = lookupRuntimeSpecialMethod(type, type.metaclass, values.string("__call__"), special, values, meter);
    meter.checkpoint();
    if (override !== undefined) return invoke(override, positional, keywords);
  }
  // The registry's canonical type is its own metaclass. Subclasses of type
  // retain ordinary construction, even if they are also named "type".
  if (type.metaclass === type) {
    if (positional.length === 1) {
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "type() takes no keyword arguments");
      return runtimeActualType(positional[0], special, meter);
    }
    if (positional.length !== 3) throw new PythonRuntimeError("TypeError", "type() takes 1 or 3 arguments");
  }
  return instantiateType<RuntimeValue, DictionaryValue>(type, positional, keywords, {
    lookupNew(requested) {
      if (requested.kind !== "type") throw Error("allocator requires an actual type");
      const name = values.string("__new__");
      // Slot eligibility is separate from ordinary class attribute lookup:
      // metaclass overrides/data descriptors may replace the allocator read.
      const present = lookupMroAttribute(requested.value.mro, name, (owner, key) => owner.namespace.items.lookup(key), meter);
      if (present === undefined) return undefined;
      let allocator: RuntimeValue;
      if (attribute !== undefined) allocator = attribute(requested, "__new__");
      else allocator = runtimeTypeAttribute(requested, "__new__", values, meter, special, { call: invoke });
      meter.checkpoint(0, 64);
      return (owner, args, named) => {
        meter.checkpoint(0, 32 + (args.length + 1) * 8);
        return invoke(allocator, [owner, ...args], named);
      };
    },
    typeOf(value) { return runtimeActualType(value, special, meter); },
    isSubtype(actual, requested) {
      if (actual.kind !== "type" || requested.kind !== "type") throw Error("subtype check requires actual types");
      for (const ancestor of actual.value.mro) { meter.checkpoint(); if (ancestor === requested.value) return true; }
      return false;
    },
    lookupInit(instance, actual) {
      if (actual.kind !== "type") throw Error("initializer requires an actual type");
      const initialize = lookupRuntimeSpecialMethod(instance, actual, values.string("__init__"), special, values, meter); meter.checkpoint();
      if (initialize === undefined) return undefined;
      meter.checkpoint(0, 64);
      return (args, named) => invoke(initialize, args, named);
    },
    isNone: value => value === values.none,
    typeName(value) { if (value.kind !== "type") throw Error("type name requires an actual type"); return value.value.name; }
  }, meter);
}
