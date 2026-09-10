import { diagnosticTypeName } from "./diagnostic-type-name.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { constructRuntimeFrozenSet } from "./runtime-frozenset.js";
import type { BuiltinFunctionValue, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Mutable sets defer consumption to init; frozen sets build during new and
 * preserve exact frozen input identity. Subclass native storage remains separate. */
export function createSetNewBuiltin(kind: "set" | "frozenset", owner: TypeValue, values: RuntimeValues, keys: KeyOperations<RuntimeValue>, meter: ExecutionMeter, owns: (type: TypeValue) => boolean): BuiltinFunctionValue {
  meter.checkpoint(0, 96);
  return values.builtinFunction({ name: `${kind}.__new__`, doc: "Create and return a new object.  See help(type) for accurate signature.",
    invoke(positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", `${kind}.__new__(): not enough arguments`);
      const type = positional[0];
      if (type.kind !== "type") {
        const name = diagnosticTypeName(invocation?.actualType?.(type).value.name ?? (type.kind === "instance" ? type.type.value.name : type.kind === "none" ? "NoneType" : type.kind), meter);
        throw new PythonRuntimeError("TypeError", `${kind}.__new__(X): X is not a type object (${name})`);
      }
      const owned = owns(type); meter.checkpoint();
      if (!owned) throw Error("type is not owned by this set allocator");
      let subtype = false;
      for (const ancestor of type.value.mro) { meter.checkpoint(); if (ancestor === owner.value) { subtype = true; break; } }
      if (!subtype) {
        const name = diagnosticTypeName(type.value.name, meter);
        throw new PythonRuntimeError("TypeError", `${kind}.__new__(${name}): ${name} is not a subtype of ${kind}`);
      }
      if (type !== owner) throw Error("set subclass allocation requires native subclass storage");
      if (kind === "set") return values.set(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
      meter.checkpoint(0, 16 + (positional.length - 1) * 8);
      return constructRuntimeFrozenSet(positional.slice(1), keywords, values, keys, meter, invocation?.iteration);
    }
  });
}
