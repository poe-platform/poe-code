import type { TupleConstant } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import type { RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";
import { createObjectNewBuiltin } from "./builtin-object-new.js";
import { createObjectInitWrapper } from "./builtin-object-init.js";
import { createTypeInitWrapper } from "./builtin-type-init.js";
import { createTypeCallWrapper } from "./builtin-type-call.js";
import { createTypeAttributeWrapper } from "./builtin-type-attribute.js";
import { createObjectAttributeWrapper } from "./builtin-object-attribute.js";
import { createObjectInitSubclassDescriptor } from "./builtin-object-init-subclass.js";
import { createObjectClassDescriptor } from "./builtin-object-class.js";
import { PythonRuntimeError } from "./error.js";
import { installMethodDecoratorBuiltins } from "./builtin-method-decorator.js";
import { installRuntimeDescriptorMethods, type IntrinsicDescriptorKind } from "./runtime-descriptor-method.js";

interface TypeEntry {
  readonly type: TypeValue;
  bases?: TupleConstant<TypeValue>;
  mro?: TupleConstant<TypeValue>;
}

/** Execution-owned canonical publication, not guest type.__new__. Callers prepare
 * layouts and enforce metaclass/layout policies before publication. Weak entries
 * do not keep otherwise unreachable types alive. Immutable hierarchy tuples are
 * cached independently from mutable namespaces; __bases__ mutation needs a later
 * replacement/invalidation protocol. Bootstrap installs read-only MRO/dict getsets;
 * remaining builtin members and methods belong to the object layer.
 */
export class RuntimeTypeRegistry {
  readonly object: TypeValue;
  readonly type: TypeValue;
  readonly #entries: WeakMap<RuntimeTypeLayout, TypeEntry>;
  readonly #methodDecorators = new Map<"staticmethod" | "classmethod", TypeValue>();
  readonly #descriptors = new Map<IntrinsicDescriptorKind, TypeValue>();

  constructor(private readonly values: RuntimeValues, private readonly keys: KeyOperations<RuntimeValue>, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 256);
    this.#entries = new WeakMap();
    const objectLayout = new RuntimeTypeLayout("object", [], values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter, runtimeDictionaryStorage)), meter, { sequenceTable: false, instanceDictionary: false, weakReferences: false });
    const typeLayout = new RuntimeTypeLayout("type", [objectLayout], values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter, runtimeDictionaryStorage)), meter, { sequenceTable: false, instanceDictionary: true, objectLayout: false, variableSized: true });
    this.type = values.type(typeLayout, "self", { immutable: true });
    this.object = values.type(objectLayout, this.type, { immutable: true });
    this.#entries.set(objectLayout, { type: this.object });
    this.#entries.set(typeLayout, { type: this.type });
    objectLayout.namespace.items.set(values.string("__new__"), createObjectNewBuiltin(values, meter, keys, this.object, type => this.#entries.get(type.value)?.type === type));
    objectLayout.namespace.items.set(values.string("__init__"), createObjectInitWrapper(values, meter, this.object));
    objectLayout.namespace.items.set(values.string("__init_subclass__"), createObjectInitSubclassDescriptor(values, meter, this.object));
    typeLayout.namespace.items.set(values.string("__init__"), createTypeInitWrapper(values, meter, this.type));
    typeLayout.namespace.items.set(values.string("__call__"), createTypeCallWrapper(values, meter, this.type));
    for (const name of ["__getattribute__", "__setattr__", "__delattr__"] as const) {
      meter.checkpoint();
      objectLayout.namespace.items.set(values.string(name), createObjectAttributeWrapper(name, values, meter, this.object));
      typeLayout.namespace.items.set(values.string(name), createTypeAttributeWrapper(name, values, meter, this.type));
    }
    objectLayout.namespace.items.set(values.string("__class__"), createObjectClassDescriptor(values, meter, this));
    meter.checkpoint(1, 192);
    const descriptors = [
      { name: "__mro__", get: (instance: TypeValue) => instance.value.mro.length === 0 ? values.none : this.metadata(instance, "mro") },
      { name: "__dict__", get: (instance: TypeValue) => values.mappingProxy(instance.value.namespace) }
    ];
    for (const entry of descriptors) {
      meter.checkpoint(1, 96);
      const descriptor = values.getsetDescriptor({
        owner: this.type, name: entry.name,
        accepts: (instance, meter) => {
          if (instance.kind !== "type") return false;
          for (const ancestor of instance.metaclass.value.mro) {
            meter.checkpoint();
            if (ancestor === this.type.value) return true;
          }
          return false;
        },
        get: instance => entry.get(instance as TypeValue)
      });
      typeLayout.namespace.items.set(values.string(entry.name), descriptor);
    }
    for (const name of ["__name__", "__qualname__"] as const) {
      meter.checkpoint(1, 128);
      typeLayout.namespace.items.set(values.string(name), values.getsetDescriptor({
        owner: this.type, name,
        accepts: (instance, meter) => {
          if (instance.kind !== "type") return false;
          for (const ancestor of instance.metaclass.value.mro) { meter.checkpoint(); if (ancestor === this.type.value) return true; }
          return false;
        },
        get: (instance, meter) => (instance as TypeValue).value.names.get(name, values, meter),
        set: (instance, value, meter) => {
          const type = instance as TypeValue;
          if (type.immutable) {
            meter.checkpoint(0, 128 + 2 * type.value.name.length);
            throw new PythonRuntimeError("TypeError", `cannot set '${name}' attribute of immutable type '${type.value.name}'`);
          }
          type.value.names.set(name, value, meter);
        },
        delete: (instance, meter) => {
          const type = instance as TypeValue;
          meter.checkpoint(0, 128 + 2 * type.value.name.length);
          throw new PythonRuntimeError("TypeError", `cannot ${type.immutable ? "set" : "delete"} '${name}' attribute of immutable type '${type.value.name}'`);
        }
      }));
    }
    Object.freeze(this);
  }

  /** Lazily publish canonical native wrapper types without charging executions
   * that never request them. Heap subclasses retain their own type identity. */
  methodDecoratorType(kind: "staticmethod" | "classmethod"): TypeValue {
    this.meter.checkpoint();
    const existing = this.#methodDecorators.get(kind);
    if (existing !== undefined) return existing;
    const namespace = this.values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(this.keys, this.meter, runtimeDictionaryStorage));
    const layout = new RuntimeTypeLayout(kind, [this.object.value], namespace, this.meter, { sequenceTable: false, instanceDictionary: true, objectLayout: false, weakReferences: false });
    const type = this.values.type(layout, this.type, { immutable: true });
    installMethodDecoratorBuiltins(kind, type, this.values, this.meter, this.keys, candidate => this.#entries.get(candidate.value)?.type === candidate);
    this.meter.checkpoint(1, 96);
    this.#entries.set(layout, { type }); this.#methodDecorators.set(kind, type);
    return type;
  }

  /** Canonical native descriptor layouts, with protocol methods published before
   * the type becomes visible. Exact functions alone own an instance dictionary. */
  descriptorType(kind: IntrinsicDescriptorKind): TypeValue {
    this.meter.checkpoint();
    const existing = this.#descriptors.get(kind);
    if (existing !== undefined) return existing;
    const namespace = this.values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(this.keys, this.meter, runtimeDictionaryStorage));
    const layout = new RuntimeTypeLayout(kind, [this.object.value], namespace, this.meter, { sequenceTable: false, instanceDictionary: kind === "function", objectLayout: false, subclassable: false, weakReferences: kind === "function" });
    const type = this.values.type(layout, this.type, { immutable: true });
    installRuntimeDescriptorMethods(kind, type, this.values, this.meter);
    this.meter.checkpoint(1, 96);
    this.#entries.set(layout, { type }); this.#descriptors.set(kind, type);
    return type;
  }

  publish(layout: RuntimeTypeLayout, metaclass: TypeValue): TypeValue {
    this.meter.checkpoint();
    if (this.#entries.get(metaclass.value)?.type !== metaclass) throw new Error("metaclass is not owned by this type registry");
    const existing = this.#entries.get(layout);
    if (existing !== undefined) {
      if (existing.type.metaclass !== metaclass) throw new Error("type layout already has a different metaclass");
      return existing.type;
    }
    for (const base of layout.bases) {
      this.meter.checkpoint();
      if (!this.#entries.has(base)) throw new Error("base layout is not published in this type registry");
    }
    this.meter.checkpoint(1, 64);
    const type = this.values.type(layout, metaclass);
    this.#entries.set(layout, { type });
    return type;
  }

  resolve(layout: RuntimeTypeLayout): TypeValue {
    this.meter.checkpoint();
    const entry = this.#entries.get(layout);
    if (entry === undefined) throw new Error("type layout is not published in this registry");
    return entry.type;
  }

  metadata(type: TypeValue, field: "bases" | "mro"): TupleConstant<TypeValue> {
    this.meter.checkpoint();
    const entry = this.#entries.get(type.value);
    if (entry?.type !== type) throw new Error("type is not owned by this registry");
    if (field === "mro" && type.value.mro.length === 0) throw new Error("type MRO is not initialized");
    const existing = entry[field];
    if (existing !== undefined) return existing;
    const layouts = type.value[field];
    const tuple = this.values.tuple(layouts.length, index => this.resolve(layouts[index]!));
    this.meter.checkpoint();
    entry[field] = tuple;
    return tuple;
  }
}
