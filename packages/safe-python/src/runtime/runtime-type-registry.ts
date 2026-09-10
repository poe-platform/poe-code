import type { TupleConstant } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import { RuntimeTypeLayout } from "./runtime-type-layout.js";
import type { RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";
import { createObjectNewBuiltin } from "./builtin-object-new.js";

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

  constructor(private readonly values: RuntimeValues, keys: KeyOperations<RuntimeValue>, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 192);
    this.#entries = new WeakMap();
    const objectLayout = new RuntimeTypeLayout("object", [], values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter, runtimeDictionaryStorage)), meter, { sequenceTable: false, instanceDictionary: false });
    const typeLayout = new RuntimeTypeLayout("type", [objectLayout], values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter, runtimeDictionaryStorage)), meter, { sequenceTable: false, instanceDictionary: false, objectLayout: false });
    this.type = values.type(typeLayout, "self", { immutable: true });
    this.object = values.type(objectLayout, this.type, { immutable: true });
    this.#entries.set(objectLayout, { type: this.object });
    this.#entries.set(typeLayout, { type: this.type });
    objectLayout.namespace.items.set(values.string("__new__"), createObjectNewBuiltin(values, meter, keys, this.object, type => this.#entries.get(type.value)?.type === type));
    meter.checkpoint(1, 192);
    const descriptors = [
      { name: "__mro__", get: (instance: TypeValue) => this.metadata(instance, "mro") },
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
    Object.freeze(this);
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
    const existing = entry[field];
    if (existing !== undefined) return existing;
    const layouts = type.value[field];
    const tuple = this.values.tuple(layouts.length, index => this.resolve(layouts[index]!));
    this.meter.checkpoint();
    entry[field] = tuple;
    return tuple;
  }
}
