import type { RuntimeClassBuilderContext } from "./builtin-build-class.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeExceptionMatches } from "./runtime-exception-matches.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import { RuntimeDictionaryNamespace } from "./runtime-dictionary-namespace.js";
import { RuntimeMappingNamespace } from "./runtime-mapping-namespace.js";
import { representationObject } from "./representation-protocol.js";
import type { RuntimeTypeRegistry } from "./runtime-type-registry.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

export interface RuntimeClassBuilderPolicy {
  readonly registry: RuntimeTypeRegistry;
  readonly keys: KeyOperations<RuntimeValue>;
}

/** Connect the generic class lifecycle to owned values and the active frame.
 * No guest protocols run until the lifecycle reaches their corresponding stage.
 * Custom builtin builders can still supply their own complete context instead. */
export function createRuntimeClassBuilderContext(policy: RuntimeClassBuilderPolicy, values: RuntimeValues, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): RuntimeClassBuilderContext {
  meter.checkpoint(1, 768);
  const dictionary = (entries?: ReadonlyMap<RuntimeValue, RuntimeValue>) => {
    const storage = new OrderedKeyMap<RuntimeValue, RuntimeValue>(policy.keys, meter, runtimeDictionaryStorage);
    if (entries !== undefined) for (const [key, value] of entries) { meter.checkpoint(); storage.set(key, value); }
    return values.dictionary(storage);
  };
  const lookup = (value: RuntimeValue, name: string) => {
    if (invocation?.attribute === undefined) throw Error("class construction requires ordinary attribute lookup");
    try { const result = invocation.attribute(value, name); meter.checkpoint(1, 16); return { value: result }; }
    catch (error) { meter.checkpoint(); if (runtimeExceptionMatches(error,"AttributeError",invocation)) return undefined; throw error; }
  };
  const repr = (value: RuntimeValue) => {
    const formatting = invocation?.formatting;
    if (formatting === undefined) throw Error("class construction diagnostics require representation formatting");
    const result = representationObject(value, "repr", formatting, meter), points = formatting.string(result); meter.checkpoint();
    if (points === undefined) throw Error("representation did not produce string storage");
    let text = "";
    for (const point of points) { meter.checkpoint(1, point > 0xffff ? 4 : 2); text += String.fromCodePoint(point); }
    return text;
  };
  return {
    bases: {
      tupleItems: value => value.kind === "tuple" ? value.items : undefined,
      isType: value => value.kind === "type",
      lookup: value => lookup(value, "__mro_entries__"),
      call(hook, original) {
        if (invocation === undefined) throw Error("class construction requires invocation capabilities");
        const result = invocation.call(hook, [original]); meter.checkpoint(); return result;
      },
      iterateTuple(value) {
        if (value.kind !== "tuple") throw Error("resolved bases must have tuple storage");
        meter.checkpoint(1, 32); return value.items[Symbol.iterator]();
      },
      tuple: values.tuple.bind(values)
    },
    preparation: {
      defaultType: policy.registry.type,
      tupleItems: value => value.kind === "tuple" ? value.items : undefined,
      isType: (value): value is TypeValue => value.kind === "type",
      typeOf(value) {
        if (invocation?.actualType === undefined) throw Error("class construction requires actual type lookup");
        const type = invocation.actualType(value); meter.checkpoint(); return type;
      },
      mro(type) {
        if (type.kind !== "type") throw Error("metaclass selection requires a type record");
        const result: TypeValue[] = [];
        for (const layout of type.value.mro) { meter.checkpoint(1, 8); result.push(policy.registry.resolve(layout)); }
        return result;
      },
      typeName(type) { if (type.kind !== "type") throw Error("type diagnostics require a type record"); return type.value.name; },
      lookupPrepare: value => lookup(value, "__prepare__"),
      callPrepare(hook, name, bases, keywords) {
        if (invocation === undefined) throw Error("class construction requires invocation capabilities");
        const result = invocation.call(hook, [name, bases], dictionary(keywords)); meter.checkpoint(); return result;
      },
      emptyNamespace: dictionary,
      isMapping(value) {
        meter.checkpoint();
        if (value.kind === "dict" || value.kind === "mappingproxy" || value.kind === "list" || value.kind === "tuple" || value.kind === "str" || value.kind === "bytes" || value.kind === "range") return true;
        if (invocation?.hasSpecial === undefined) throw Error("class preparation requires mapping-slot inspection");
        const result = invocation.hasSpecial(value, "__getitem__"); meter.checkpoint(); return result;
      }
    },
    executeBody(body, namespace) {
      if (body.kind !== "function") throw Error("class body requires a function record");
      if (invocation?.executeClassBody === undefined) throw Error("class construction requires prepared body execution");
      const result = invocation.executeClassBody(body, namespace); meter.checkpoint(); return result;
    },
    storeOriginalBases(namespace, original) {
      if (invocation === undefined) throw Error("class construction requires invocation capabilities");
      const locals = namespace.kind === "dict" ? new RuntimeDictionaryNamespace(namespace, values, meter, invocation)
        : new RuntimeMappingNamespace(namespace, values, meter, invocation);
      locals.store("__orig_bases__", original); meter.checkpoint();
    },
    construction: {
      call(meta, name, bases, namespace, keywords) {
        if (invocation === undefined) throw Error("class construction requires invocation capabilities");
        const result = invocation.call(meta, [name, bases, namespace], dictionary(keywords)); meter.checkpoint(); return result;
      },
      isType: value => value.kind === "type", reprName: repr, repr
    }
  };
}
