import { PythonRuntimeError } from "./error.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { initializeRuntimeMethodDecorator } from "./runtime-method-decorator-initialization.js";
import type { RuntimeValues, TypeValue } from "./runtime-values.js";

/** Install native allocation and initialization independently: direct __new__
 * ignores extra arguments and produces a None-backed, metadata-empty wrapper. */
export function installMethodDecoratorBuiltins(kind: "staticmethod" | "classmethod", owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter, owns: (type: TypeValue) => boolean): void {
  meter.checkpoint(1, 192);
  owner.value.namespace.items.set(values.string("__new__"), values.builtinFunction({ name: `${kind}.__new__`, invoke(positional, _keywords, meter, invocation) {
    meter.checkpoint();
    if (positional.length === 0) throw new PythonRuntimeError("TypeError", `${kind}.__new__(): not enough arguments`);
    const type = positional[0]!;
    if (type.kind !== "type") {
      const name = type.kind === "instance" ? type.type.value.name : type.kind === "none" ? "NoneType" : invocation?.typeName?.(type) ?? type.kind;
      meter.checkpoint();
      throw new PythonRuntimeError("TypeError", `${kind}.__new__(X): X is not a type object (${diagnosticTypeName(name, meter)})`);
    }
    const owned = owns(type); meter.checkpoint();
    if (!owned) throw Error("type is not owned by this method-wrapper allocator");
    let subtype = false;
    for (const ancestor of type.value.mro) { meter.checkpoint(); if (ancestor === owner.value) { subtype = true; break; } }
    if (!subtype) {
      const name = diagnosticTypeName(type.value.name, meter);
      throw new PythonRuntimeError("TypeError", `${kind}.__new__(${name}): ${name} is not a subtype of ${kind}`);
    }
    return values.methodDecorator(kind, values.none, type);
  } }));
  owner.value.namespace.items.set(values.string("__init__"), values.wrapperDescriptor({ owner, name: "__init__",
    accepts(instance, meter) {
      if (instance.kind !== kind) return false;
      if (instance.type === undefined) return true;
      for (const ancestor of instance.type.value.mro) { meter.checkpoint(); if (ancestor === owner.value) return true; }
      return false;
    },
    invoke(instance, positional, keywords, meter, invocation) {
      if (instance.kind !== kind) throw Error("invalid method-wrapper initializer receiver");
      return initializeRuntimeMethodDecorator(instance, positional, keywords, values, meter, (value, name) => {
        if (invocation?.attribute === undefined) throw Error("method-wrapper initialization requires an attribute policy");
        return invocation.attribute(value, name);
      });
    }
  }));
}
