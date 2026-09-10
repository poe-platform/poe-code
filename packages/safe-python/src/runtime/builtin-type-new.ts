import { PythonRuntimeError } from "./error.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { lookupMroAttribute } from "./class-attributes.js";
import { selectTypeMetaclass } from "./metaclass.js";
import { allocateRuntimeType } from "./runtime-type-allocation.js";
import type { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import { hasRuntimeInstanceAttributes, type BuiltinFunctionValue, type RuntimeValue, type RuntimeValues, type TypeValue } from "./runtime-values.js";

/** Native type allocation, including metaclass winner delegation and post-create
 * hooks. Unlike class statements this does not resolve __mro_entries__, execute
 * a class body, apply decorators or invoke the metaclass initializer itself. */
export function createTypeNewBuiltin(values: RuntimeValues, meter: ExecutionMeter, registry: RuntimeTypeRegistry): BuiltinFunctionValue {
  meter.checkpoint(1, 128);
  const newName = values.string("__new__");
  const builtin: BuiltinFunctionValue = values.builtinFunction({ name: "__new__", owner: registry.type, doc: "Create and return a new object.  See help(type) for accurate signature.",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      const typeName = (value: RuntimeValue, maxBytes?: number) => {
        const name = hasRuntimeInstanceAttributes(value) ? value.type.value.name : value.kind === "type" ? value.metaclass.value.name
          : value.kind === "cell" ? invocation?.typeName?.(value) ?? "cell" : value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
        meter.checkpoint();
        const result = maxBytes === undefined ? name : diagnosticTypeName(name, meter, maxBytes);
        meter.checkpoint(0, 128 + 2 * result.length); return result;
      };
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", "type.__new__(): not enough arguments");
      const metaclass = positional[0];
      if (metaclass.kind !== "type") throw new PythonRuntimeError("TypeError", `type.__new__(X): X is not a type object (${typeName(metaclass)})`);
      if (registry.resolve(metaclass.value) !== metaclass) throw Error("metaclass is not owned by this type allocator");
      let subtype = false;
      for (const ancestor of metaclass.value.mro) { meter.checkpoint(); if (ancestor === registry.type.value) { subtype = true; break; } }
      if (!subtype) {
        meter.checkpoint(0, 128 + 4 * metaclass.value.name.length);
        throw new PythonRuntimeError("TypeError", `type.__new__(${metaclass.value.name}): ${metaclass.value.name} is not a subtype of type`);
      }
      if (positional.length !== 4) throw new PythonRuntimeError("TypeError", `type.__new__() takes exactly 3 arguments (${positional.length - 1} given)`);
      const name = positional[1], bases = positional[2], namespace = positional[3];
      if (name.kind !== "str") throw new PythonRuntimeError("TypeError", `type.__new__() argument 1 must be str, not ${typeName(name, 50)}`);
      if (bases.kind !== "tuple") throw new PythonRuntimeError("TypeError", `type.__new__() argument 2 must be tuple, not ${typeName(bases, 50)}`);
      if (namespace.kind !== "dict") throw new PythonRuntimeError("TypeError", `type.__new__() argument 3 must be dict, not ${typeName(namespace, 50)}`);
      for (const base of bases.items) {
        meter.checkpoint();
        if (base.kind === "type") {
          if (registry.resolve(base.value) !== base) throw Error("base is not owned by this type allocator");
        } else {
          if (invocation?.attribute === undefined) throw Error("native type allocation requires ordinary base attribute lookup");
          let found = true;
          try { invocation.attribute(base, "__mro_entries__"); }
          catch (error) { meter.checkpoint(); if (runtimeExceptionMatches(error, "AttributeError", invocation)) found = false; else throw error; }
          meter.checkpoint();
          if (found) throw new PythonRuntimeError("TypeError", "type() doesn't support MRO entry resolution; use types.new_class()");
        }
      }
      const baseMetaclasses: TypeValue[] = [];
      for (const base of bases.items) {
        meter.checkpoint(1, 8);
        if (base.kind === "type") baseMetaclasses.push(base.metaclass);
        else {
          if (invocation?.actualType === undefined) throw Error("native type allocation requires an actual type policy");
          baseMetaclasses.push(invocation.actualType(base)); meter.checkpoint();
        }
      }
      const winner = selectTypeMetaclass(metaclass, baseMetaclasses, type => {
        const mro: TypeValue[] = [];
        for (const layout of type.value.mro) { meter.checkpoint(1, 8); mro.push(registry.resolve(layout)); }
        return mro;
      }, meter);
      if (winner !== metaclass) {
        const allocator = lookupMroAttribute(winner.value.mro, newName, (owner, name) => owner.namespace.items.lookup(name), meter)?.value;
        if (allocator !== builtin) {
          if (invocation?.attribute === undefined) throw Error("metaclass delegation requires ordinary attribute lookup");
          const hook = invocation.attribute(winner, "__new__"); meter.checkpoint();
          const result = invocation.call(hook, [winner, name, bases, namespace], keywords); meter.checkpoint(); return result;
        }
      }
      const concreteBases: TypeValue[] = [];
      for (const base of bases.items) { meter.checkpoint(1, 8); if (base.kind !== "type") throw Error("native class bases require concrete type records"); concreteBases.push(base); }
      if (invocation?.finalizeType === undefined) throw Error("native type allocation requires class finalization");
      const type = allocateRuntimeType(name, concreteBases, namespace, winner, registry, values, meter, {
        module: invocation.moduleName, get iteration() { return invocation.iteration; }
      });
      invocation.finalizeType(type, keywords); meter.checkpoint(); return type;
    }
  });
  return builtin;
}
