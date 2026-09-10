import type { TupleConstant } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import type { RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";
import { createObjectNewBuiltin } from "./builtin-object-new.js";
import { createObjectInitWrapper } from "./builtin-object-init.js";
import { createObjectFormatDescriptor } from "./builtin-object-format.js";
import { createObjectStrWrapper } from "./builtin-object-str.js";
import { createObjectReprWrapper } from "./builtin-object-repr.js";
import { createDescriptorReprWrapper } from "./runtime-descriptor-repr.js";
import { createBoundCallableReprWrapper } from "./runtime-bound-callable-repr.js";
import { createObjectHashWrapper } from "./builtin-object-hash.js";
import { createObjectNeWrapper } from "./builtin-object-ne.js";
import { createObjectEqWrapper } from "./builtin-object-eq.js";
import { installObjectOrderingWrappers } from "./builtin-object-ordering.js";
import { createTypeInitWrapper } from "./builtin-type-init.js";
import { createTypeNewBuiltin } from "./builtin-type-new.js";
import { createTypePrepareDescriptor } from "./builtin-type-prepare.js";
import { createTypeReprWrapper } from "./builtin-type-repr.js";
import { createTypeCallWrapper } from "./builtin-type-call.js";
import { createTypeAttributeWrapper } from "./builtin-type-attribute.js";
import { createObjectAttributeWrapper } from "./builtin-object-attribute.js";
import { createObjectInitSubclassDescriptor } from "./builtin-object-init-subclass.js";
import { createObjectClassDescriptor } from "./builtin-object-class.js";
import { PythonRuntimeError } from "./error.js";
import { installMethodDecoratorBuiltins } from "./builtin-method-decorator.js";
import { installRuntimeDescriptorMethods, type IntrinsicDescriptorKind } from "./runtime-descriptor-method.js";
import { installRuntimeComparisonMethods, type NativeBoundCallableKind } from "./runtime-native-comparison-method.js";
import { installRuntimeListMethodDescriptors } from "./runtime-list-method-descriptors.js";
import { installRuntimeListSequenceSlots } from "./runtime-list-sequence-slots.js";
import { installRuntimeSetSlots } from "./runtime-set-slots.js";
import { installRuntimeSetMethodDescriptors } from "./runtime-set-method-descriptors.js";
import { installRuntimeSetOperatorSlots } from "./runtime-set-operator-slots.js";
import { installRuntimeTupleSlots } from "./runtime-tuple-slots.js";
import { installRuntimeDictionaryMethodDescriptors } from "./runtime-dictionary-method-descriptors.js";
import { installRuntimeDictionarySlots } from "./runtime-dictionary-slots.js";
import { installRuntimeTupleArithmeticSlots } from "./runtime-tuple-arithmetic-slots.js";
import { createTupleNewBuiltin } from "./builtin-tuple-new.js";
import { createSetNewBuiltin } from "./builtin-set-new.js";
import { installRuntimeListSubscriptionSlots } from "./runtime-list-subscription-slots.js";
import { installRuntimeListArithmeticSlots } from "./runtime-list-arithmetic-slots.js";
import { createListInitWrapper } from "./builtin-list-init.js";
import { createListNewBuiltin } from "./builtin-list-new.js";
import { createListReprWrapper } from "./builtin-list-repr.js";
import { createBoundCallableHashWrapper } from "./builtin-bound-callable-hash.js";

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
  readonly #boundCallables = new Map<NativeBoundCallableKind, TypeValue>();
  #listType: TypeValue | undefined;
  #tupleType: TypeValue | undefined;
  #dictionaryType: TypeValue | undefined;
  readonly #sets = new Map<"set" | "frozenset", TypeValue>();

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
    typeLayout.namespace.items.set(values.string("__new__"), createTypeNewBuiltin(values, meter, this));
    typeLayout.namespace.items.set(values.string("__prepare__"), createTypePrepareDescriptor(values, meter, keys, this.type));
    typeLayout.namespace.items.set(values.string("__repr__"), createTypeReprWrapper(values, meter, this.type));
    objectLayout.namespace.items.set(values.string("__init__"), createObjectInitWrapper(values, meter, this.object));
    objectLayout.namespace.items.set(values.string("__format__"), createObjectFormatDescriptor(this.object, values, meter));
    objectLayout.namespace.items.set(values.string("__str__"), createObjectStrWrapper(this.object, values, meter));
    objectLayout.namespace.items.set(values.string("__repr__"), createObjectReprWrapper(this.object, values, meter));
    objectLayout.namespace.items.set(values.string("__hash__"), createObjectHashWrapper(values, meter, this.object));
    objectLayout.namespace.items.set(values.string("__ne__"), createObjectNeWrapper(values, meter, this.object));
    objectLayout.namespace.items.set(values.string("__eq__"), createObjectEqWrapper(values, meter, this.object));
    installObjectOrderingWrappers(values, meter, this.object);
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
      { name: "__bases__", get: (instance: TypeValue) => this.metadata(instance, "bases") },
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
    namespace.items.set(this.values.string("__repr__"), createDescriptorReprWrapper(kind, type, this.values, this.meter));
    this.meter.checkpoint(1, 96);
    this.#entries.set(layout, { type }); this.#descriptors.set(kind, type);
    return type;
  }

  /** Canonical bound-callable types; native comparison slots must shadow the
   * identity-only object slot. Remaining native members are installed separately. */
  boundCallableType(kind: NativeBoundCallableKind): TypeValue {
    this.meter.checkpoint();
    const existing = this.#boundCallables.get(kind);
    if (existing !== undefined) return existing;
    const namespace = this.values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(this.keys, this.meter, runtimeDictionaryStorage));
    const layout = new RuntimeTypeLayout(kind, [this.object.value], namespace, this.meter, { sequenceTable: false, instanceDictionary: false, objectLayout: false, subclassable: false, weakReferences: kind !== "method-wrapper" });
    const type = this.values.type(layout, this.type, { immutable: true });
    installRuntimeComparisonMethods(kind, type, this.values, this.meter);
    namespace.items.set(this.values.string("__repr__"), createBoundCallableReprWrapper(kind, type, this.values, this.meter));
    namespace.items.set(this.values.string("__hash__"), createBoundCallableHashWrapper(kind, type, this.values, this.meter));
    this.meter.checkpoint(1, 96);
    this.#entries.set(layout, { type }); this.#boundCallables.set(kind, type);
    return type;
  }

  /** Canonical set layouts, storage protocols, methods and numeric slots. */
  setType(kind: "set" | "frozenset"): TypeValue {
    this.meter.checkpoint();
    const existing = this.#sets.get(kind);
    if (existing !== undefined) return existing;
    const namespace = this.values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(this.keys, this.meter, runtimeDictionaryStorage));
    const layout = new RuntimeTypeLayout(kind, [this.object.value], namespace, this.meter, { sequenceTable: true, instanceDictionary: false, objectLayout: false, weakReferences: true });
    const type = this.values.type(layout, this.type, { immutable: true });
    installRuntimeSetSlots(kind, type, this.values, this.meter);
    installRuntimeSetMethodDescriptors(kind, type, this.values, this.meter);
    installRuntimeSetOperatorSlots(kind, type, this.values, this.meter);
    namespace.items.set(this.values.string("__new__"), createSetNewBuiltin(kind, type, this.values, this.keys, this.meter, requested => this.#entries.get(requested.value)?.type === requested));
    installRuntimeComparisonMethods(kind, type, this.values, this.meter);
    this.meter.checkpoint(1, 96);
    this.#entries.set(layout, { type }); this.#sets.set(kind, type);
    return type;
  }

  /** Canonical tuple allocation and protocols, including owned subclass storage. */
  tupleType(): TypeValue {
    this.meter.checkpoint();
    if (this.#tupleType !== undefined) return this.#tupleType;
    const namespace = this.values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(this.keys, this.meter, runtimeDictionaryStorage));
    const layout = new RuntimeTypeLayout("tuple", [this.object.value], namespace, this.meter, { sequenceTable: true, instanceDictionary: false, objectLayout: false, weakReferences: false, variableSized: true });
    const type = this.values.type(layout, this.type, { immutable: true });
    installRuntimeTupleSlots(type, this.values, this.meter);
    installRuntimeTupleArithmeticSlots(type, this.values, this.meter);
    namespace.items.set(this.values.string("__new__"), createTupleNewBuiltin(type, this.values, this.meter, requested => this.#entries.get(requested.value)?.type === requested));
    installRuntimeComparisonMethods("tuple", type, this.values, this.meter);
    this.meter.checkpoint(1, 64);
    this.#entries.set(layout, { type }); this.#tupleType = type;
    return type;
  }

  /** Canonical dictionary identity and native method catalog. */
  dictionaryType(): TypeValue {
    this.meter.checkpoint();
    if (this.#dictionaryType !== undefined) return this.#dictionaryType;
    const namespace = this.values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(this.keys, this.meter, runtimeDictionaryStorage));
    const layout = new RuntimeTypeLayout("dict", [this.object.value], namespace, this.meter, { sequenceTable: true, instanceDictionary: false, objectLayout: false, weakReferences: false });
    const type = this.values.type(layout, this.type, { immutable: true });
    installRuntimeDictionaryMethodDescriptors(type, this.values, this.meter);
    installRuntimeDictionarySlots(type, this.values, this.meter);
    installRuntimeComparisonMethods("dict", type, this.values, this.meter);
    this.meter.checkpoint(1, 64);
    this.#entries.set(layout, { type }); this.#dictionaryType = type;
    return type;
  }

  listType(): TypeValue {
    this.meter.checkpoint();
    if (this.#listType !== undefined) return this.#listType;
    const namespace = this.values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(this.keys, this.meter, runtimeDictionaryStorage));
    const layout = new RuntimeTypeLayout("list", [this.object.value], namespace, this.meter, { sequenceTable: true, instanceDictionary: false, objectLayout: false, weakReferences: false });
    const type = this.values.type(layout, this.type, { immutable: true });
    installRuntimeListMethodDescriptors(type, this.values, this.meter);
    installRuntimeListSequenceSlots(type, this.values, this.meter);
    installRuntimeListSubscriptionSlots(type, this.values, this.meter);
    installRuntimeListArithmeticSlots(type, this.values, this.meter);
    namespace.items.set(this.values.string("__init__"), createListInitWrapper(type, this.values, this.meter));
    namespace.items.set(this.values.string("__repr__"), createListReprWrapper(type, this.values, this.meter));
    namespace.items.set(this.values.string("__new__"), createListNewBuiltin(type, this.values, this.meter, requested => this.#entries.get(requested.value)?.type === requested));
    installRuntimeComparisonMethods("list", type, this.values, this.meter);
    namespace.items.set(this.values.string("__hash__"), this.values.none);
    this.meter.checkpoint(1, 64);
    this.#entries.set(layout, { type }); this.#listType = type;
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
