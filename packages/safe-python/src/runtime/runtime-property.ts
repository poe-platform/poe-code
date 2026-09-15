import {runtimeNativeMethodDiagnostic} from "./runtime-native-method-diagnostic.js";
import {PythonRuntimeError} from "./error.js";
import type {ExecutionMeter} from "./execution-budget.js";
import {OrderedKeyMap, type KeyOperations} from "./ordered-key-map.js";
import {runtimeDictionaryStorage} from "./runtime-dictionary-storage.js";
import {bindRuntimeClinicArguments} from "./runtime-clinic-arguments.js";
import {runtimeExceptionMatches} from "./runtime-exception-matches.js";
import {diagnosticTypeName} from "./diagnostic-type-name.js";
import {representationObject} from "./representation-protocol.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {PythonUnicodeMessageError} from "./unicode-message-error.js";
import type {BuiltinInvocationContext, RuntimeValue, RuntimeValues, TypeValue} from "./runtime-values.js";

interface PropertyState {
  fget?: RuntimeValue;
  fset?: RuntimeValue;
  fdel?: RuntimeValue;
  doc?: RuntimeValue;
  name?: RuntimeValue;
  getterDoc: boolean;
}

/** CPython 3.14.7 Objects/descrobject.c property storage and callbacks. State is
 * private to this interpreter's type installation, independent of guest slots,
 * dictionaries, descriptors and overridden attribute access. */
export function installRuntimeProperty(owner: TypeValue, values: RuntimeValues, meter: ExecutionMeter, keys: KeyOperations<RuntimeValue>, owns: (type: TypeValue) => boolean): void {
  const states = new WeakMap<RuntimeValue, PropertyState>();
  const accepts = (value: RuntimeValue) => states.has(value);
  const namespace = owner.value.namespace.items;
  const optional = (object: RuntimeValue, name: string, context: BuiltinInvocationContext): RuntimeValue | undefined => {
    if (context.attribute === undefined) throw Error("properties require interpreter attribute access");
    try { return context.attribute(object, name); }
    catch (error) { if (runtimeExceptionMatches(error, "AttributeError", context)) return undefined; throw error; }
  };
  const propertyName = (state: PropertyState, context: BuiltinInvocationContext) => state.name ?? (state.fget === undefined ? undefined : optional(state.fget, "__name__", context));
  namespace.set(values.string("__new__"), values.builtinFunction({name: "__new__", owner, keywordValidation: "callee", doc: "Create and return a new object.  See help(type) for accurate signature.", textSignature: "($type, *args, **kwargs)", invoke(args, _keywords, meter, context) {
    meter.checkpoint();
    if (args.length === 0) throw new PythonRuntimeError("TypeError", "property.__new__(): not enough arguments");
    const type = args[0];
    if (type.kind !== "type") throw new PythonRuntimeError("TypeError", `property.__new__(X): X is not a type object (${diagnosticTypeName(context?.typeName?.(type) ?? type.kind, meter)})`);
    if (!owns(type)) throw Error("property type is not owned by this interpreter");
    let subtype = false;
    for (const base of type.value.mro) { meter.checkpoint(); if (base === owner.value) { subtype = true; break; } }
    if (!subtype) {
      const name = diagnosticTypeName(type.value.name, meter);
      throw new PythonRuntimeError("TypeError", `property.__new__(${name}): ${name} is not a subtype of property`);
    }
    meter.checkpoint(1, 96);
    const dictionary = type.value.hasInstanceDictionary ? values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter, runtimeDictionaryStorage)) : undefined;
    const value = values.instance(type, dictionary);
    states.set(value, {getterDoc: false});
    return value;
  }}));
  namespace.set(values.string("__init__"), values.wrapperDescriptor({owner, name: "__init__", accepts, textSignature: "($self, /, *args, **kwargs)", boundKeywordValidation: "callee", invoke(receiver, args, keywords, meter, context) {
    if (context === undefined) throw Error("properties require an invocation context");
    const count = args.length + keywords.items.size;
    if (count > 4) throw new PythonRuntimeError("TypeError", `property() takes at most 4 ${args.length === 0 ? "keyword " : ""}arguments (${count} given)`);
    const bound = bindRuntimeClinicArguments("property", ["fget", "fset", "fdel", "doc"], args, keywords, values, meter, context);
    const state = states.get(receiver)!;
    for (const [index, name] of ["fget", "fset", "fdel"].entries()) state[name as "fget" | "fset" | "fdel"] = bound[index]?.kind === "none" ? undefined : bound[index];
    state.doc = undefined; state.name = undefined; state.getterDoc = false;
    let doc: RuntimeValue | undefined = bound[3]?.kind === "none" ? undefined : bound[3];
    if (doc === undefined && state.fget !== undefined) {
      doc = optional(state.fget, "__doc__", context);
      if (doc?.kind === "none") doc = undefined;
      if (doc !== undefined) state.getterDoc = true;
    }
    if (receiver.kind !== "instance") throw Error("invalid property storage");
    if (receiver.type === owner) state.doc = doc;
    else {
      if (context.setAttribute === undefined) throw Error("property subclasses require interpreter attribute mutation");
      try { context.setAttribute(receiver, "__doc__", doc ?? values.none); }
      catch (error) { if (state.getterDoc || !runtimeExceptionMatches(error, "AttributeError", context)) throw error; }
    }
    meter.checkpoint();
    return values.none;
  }}));
  for (const name of ["fget", "fset", "fdel", "__doc__"] as const) {
    const field = name === "__doc__" ? "doc" : name;
    namespace.set(values.string(name), values.memberDescriptor({owner, name, accepts,
      get: receiver => states.get(receiver)![field] ?? values.none,
      ...(name === "__doc__" ? {set(receiver: RuntimeValue, value: RuntimeValue) { states.get(receiver)!.doc = value; }, delete(receiver: RuntimeValue) { states.get(receiver)!.doc = undefined; }} : {})
    }));
  }
  namespace.set(values.string("__name__"), values.getsetDescriptor({owner, name: "__name__", accepts,
    get(receiver, _meter, context) {
      if (context === undefined) throw Error("property names require an invocation context");
      const name = propertyName(states.get(receiver)!, context);
      if (name === undefined) throw new PythonRuntimeError("AttributeError", "'property' object has no attribute '__name__'");
      return name;
    },
    set(receiver, value) { states.get(receiver)!.name = value; },
    delete(receiver) { states.get(receiver)!.name = undefined; }
  }));
  namespace.set(values.string("__isabstractmethod__"), values.getsetDescriptor({owner, name: "__isabstractmethod__", accepts,
    get(receiver, meter, context) {
      if (context?.truth === undefined) throw Error("property abstractness requires interpreter truth");
      const state = states.get(receiver)!;
      for (const field of ["fget", "fset", "fdel"] as const) {
        // Read each field only after the preceding callback: callbacks may
        // reinitialize this property while abstractness is being computed.
        const callback = state[field];
        if (callback === undefined) continue;
        const flag = optional(callback, "__isabstractmethod__", context);
        meter.checkpoint();
        if (flag !== undefined && context.truth(flag)) return values.true;
      }
      return values.false;
    }
  }));
  for (const [name, field] of [["getter", "fget"], ["setter", "fset"], ["deleter", "fdel"]] as const) {
    namespace.set(values.string(name), values.methodDescriptor({owner, name, accepts, doc: `Descriptor to obtain a copy of the property with a different ${name}.`, textSignature: "($self, object, /)", invoke(receiver, args, keywords, meter, context, bound) {
      if (keywords.items.size || args.length !== 1) {
        const label = runtimeNativeMethodDiagnostic(receiver, owner, name, bound, values, meter, context);
        throw new PythonRuntimeError("TypeError", keywords.items.size ? `${label} takes no keyword arguments` : `${label} takes exactly one argument (${args.length} given)`);
      }
      if (context === undefined || receiver.kind !== "instance") throw Error("property copies require an invocation context");
      const state = states.get(receiver)!;
      const replacement = {...state};
      if (args[0].kind !== "none") replacement[field] = args[0];
      const doc = state.getterDoc && replacement.fget !== undefined ? values.none : state.doc ?? values.none;
      const result = context.call(receiver.type, [replacement.fget ?? values.none, replacement.fset ?? values.none, replacement.fdel ?? values.none, doc]);
      meter.checkpoint();
      const copied = states.get(result);
      if (copied !== undefined) copied.name = state.name;
      return result;
    }}));
  }
  namespace.set(values.string("__set_name__"), values.methodDescriptor({owner, name: "__set_name__", accepts, doc: "Method to set name of a property.", textSignature: "($self, owner, name, /)", invoke(receiver, args, keywords) {
    if (keywords.items.size) throw new PythonRuntimeError("TypeError", "property.__set_name__() takes no keyword arguments");
    if (args.length !== 2) throw new PythonRuntimeError("TypeError", `__set_name__() takes 2 positional arguments but ${args.length} were given`);
    states.get(receiver)!.name = args[1];
    return values.none;
  }}));
  for (const [name, field] of [["__get__", "fget"], ["__set__", "fset"], ["__delete__", "fdel"]] as const) {
    namespace.set(values.string(name), values.wrapperDescriptor({owner, name, accepts, textSignature: name === "__get__" ? "($self, instance, owner=None, /)" : name === "__set__" ? "($self, instance, value, /)" : "($self, instance, /)", invoke(receiver, args, keywords, meter, context) {
      if (keywords.items.size) throw new PythonRuntimeError("TypeError", `wrapper ${name}() takes no keyword arguments`);
      const count = name === "__delete__" ? 1 : 2;
      if (name === "__get__") {
        if (args.length < 1 || args.length > 2) throw new PythonRuntimeError("TypeError", `__get__ expected at ${args.length < 1 ? "least 1 argument" : "most 2 arguments"}, got ${args.length}`);
        if (args[0].kind === "none") {
          if (args.length === 1 || args[1].kind === "none") throw new PythonRuntimeError("TypeError", "__get__(None, None) is invalid");
          return receiver;
        }
      } else if (args.length !== count) throw new PythonRuntimeError("TypeError", `${name === "__set__" ? "__set__ " : ""}expected ${count} argument${count === 1 ? "" : "s"}, got ${args.length}`);
      if (context === undefined) throw Error("property access requires an invocation context");
      const state = states.get(receiver)!, callback = state[field];
      if (callback === undefined) {
        const nameValue = propertyName(state, context);
        if (context.actualType === undefined || context.formatting === undefined) throw Error("property diagnostics require interpreter type and representation protocols");
        const type = context.actualType(args[0]);
        const qualify = type.value.names.get("__qualname__", values, meter);
        const parts = [values.string("property").value];
        for (const [prefix, value] of [[" ", nameValue], [" of ", qualify]] as const) {
          if (value === undefined) continue;
          parts.push(values.string(prefix).value, runtimeStringPayload(representationObject(value, "repr", context.formatting, meter))!.value);
        }
        parts.push(values.string(` object has no ${field === "fget" ? "getter" : field === "fset" ? "setter" : "deleter"}`).value);
        throw new PythonUnicodeMessageError("AttributeError", values.string("").value.join(parts, meter), meter);
      }
      const result = context.call(callback, name === "__set__" ? [args[0], args[1]] : [args[0]]);
      meter.checkpoint();
      return name === "__get__" ? result : values.none;
    }}));
  }
}
