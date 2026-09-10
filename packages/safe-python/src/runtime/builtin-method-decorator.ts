import { PythonRuntimeError } from "./error.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { initializeRuntimeMethodDecorator } from "./runtime-method-decorator-initialization.js";
import { getRuntimeMethodDecorator } from "./runtime-method-decorator.js";
import { hasRuntimeInstanceAttributes, type RuntimeValue, type RuntimeValues, type TypeValue } from "./runtime-values.js";
import type { KeyOperations } from "./ordered-key-map.js";

/** Install native allocation and initialization independently: direct __new__
 * ignores extra arguments and produces a None-backed, metadata-empty wrapper. */
export function installMethodDecoratorBuiltins(kind: "staticmethod" | "classmethod", owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter, keys: KeyOperations<RuntimeValue>, owns: (type: TypeValue) => boolean): void {
  meter.checkpoint(1, 192);
  const accepts = (instance: RuntimeValue, meter: ExecutionMeter): boolean => {
    if (instance.kind !== kind) return false;
    if (instance.type === undefined) return true;
    for (const ancestor of instance.type.value.mro) { meter.checkpoint(); if (ancestor === owner.value) return true; }
    return false;
  };
  for (const name of ["__annotations__", "__annotate__"]) {
    meter.checkpoint(1, 128);
    owner.value.namespace.items.set(values.string(name), values.getsetDescriptor({ owner, name, accepts,
      get(instance, meter, invocation) {
        if (instance.kind !== kind) throw Error("invalid method-wrapper annotation receiver");
        const cached = instance.state.attributes.get(name);
        if (cached !== undefined) return cached;
        if (invocation?.attribute === undefined) throw Error("method-wrapper annotations require an attribute policy");
        const result = invocation.attribute(instance.value, name); meter.checkpoint();
        instance.state.attributes.set(name, result); return result;
      },
      set(instance, value) {
        if (instance.kind !== kind) throw Error("invalid method-wrapper annotation receiver");
        instance.state.attributes.set(name, value);
      },
      delete(instance, meter) {
        if (instance.kind !== kind) throw Error("invalid method-wrapper annotation receiver");
        if (!instance.state.attributes.delete(name)) {
          const typeName = diagnosticTypeName(instance.type?.value.name ?? kind, meter, 100);
          meter.checkpoint(0, 128 + 2 * typeName.length);
          throw new PythonRuntimeError("AttributeError", `'${typeName}' object has no attribute '${name}'`);
        }
      }
    }));
  }
  owner.value.namespace.items.set(values.string("__isabstractmethod__"), values.getsetDescriptor({ owner, name: "__isabstractmethod__", accepts,
    get(instance, meter, invocation) {
      if (instance.kind !== kind) throw Error("invalid method-wrapper abstractness receiver");
      if (instance.value.kind === "none") return values.false;
      if (invocation?.attribute === undefined) throw Error("method-wrapper abstractness requires an attribute policy");
      let flag: RuntimeValue;
      try { flag = invocation.attribute(instance.value, "__isabstractmethod__"); }
      catch (error) {
        meter.checkpoint();
        if (error instanceof PythonRuntimeError && error.name === "AttributeError") return values.false;
        throw error;
      }
      meter.checkpoint();
      if (invocation.truth === undefined) throw Error("method-wrapper abstractness requires a truth policy");
      const result = invocation.truth(flag); meter.checkpoint(); return values.boolean(result);
    }
  }));
  owner.value.namespace.items.set(values.string("__dict__"), values.getsetDescriptor({ owner, name: "__dict__", accepts,
    get(instance) {
      if (instance.kind !== kind) throw Error("invalid method-wrapper dictionary receiver");
      return instance.state.attributes.dictionary(keys);
    },
    set(instance, value, meter) {
      if (instance.kind !== kind) throw Error("invalid method-wrapper dictionary receiver");
      if (value.kind !== "dict") {
        const name = hasRuntimeInstanceAttributes(value) ? value.type.value.name : value.kind === "type" ? value.metaclass.value.name : value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
        meter.checkpoint(0, 128 + 2 * name.length);
        throw new PythonRuntimeError("TypeError", `__dict__ must be set to a dictionary, not a '${name}'`);
      }
      instance.state.attributes.replace(value);
    },
    delete() { throw new PythonRuntimeError("TypeError", "cannot delete __dict__"); }
  }));
  for (const name of ["__func__", "__wrapped__"]) {
    meter.checkpoint(1, 64);
    owner.value.namespace.items.set(values.string(name), values.memberDescriptor({ owner, name, accepts,
      get(instance) {
        if (instance.kind !== kind) throw Error("invalid method-wrapper member receiver");
        return instance.value;
      }
    }));
  }
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
    accepts,
    invoke(instance, positional, keywords, meter, invocation) {
      if (instance.kind !== kind) throw Error("invalid method-wrapper initializer receiver");
      return initializeRuntimeMethodDecorator(instance, positional, keywords, values, meter, (value, name) => {
        if (invocation?.attribute === undefined) throw Error("method-wrapper initialization requires an attribute policy");
        return invocation.attribute(value, name);
      });
    }
  }));
  owner.value.namespace.items.set(values.string("__get__"), values.wrapperDescriptor({ owner, name: "__get__", accepts,
    invoke(instance, positional, keywords, meter, invocation) {
      meter.checkpoint();
      if (keywords.items.size !== 0) throw new PythonRuntimeError("TypeError", "wrapper __get__() takes no keyword arguments");
      if (positional.length === 0) throw new PythonRuntimeError("TypeError", "__get__ expected at least 1 argument, got 0");
      if (positional.length > 2) throw new PythonRuntimeError("TypeError", `__get__ expected at most 2 arguments, got ${positional.length}`);
      if (instance.kind !== kind) throw Error("invalid method-wrapper descriptor receiver");
      return getRuntimeMethodDecorator(instance, positional[0]!, positional[1] ?? values.none, values, meter, invocation?.actualType?.bind(invocation));
    }
  }));
  if (kind === "staticmethod") {
    owner.value.namespace.items.set(values.string("__call__"), values.wrapperDescriptor({ owner, name: "__call__", accepts,
      invoke(instance, positional, keywords, meter, invocation) {
        meter.checkpoint();
        if (instance.kind !== kind) throw Error("invalid staticmethod call receiver");
        if (invocation === undefined) throw Error("staticmethod calls require an invocation policy");
        const result = invocation.call(instance.value, positional, keywords); meter.checkpoint(); return result;
      }
    }));
  }
}
