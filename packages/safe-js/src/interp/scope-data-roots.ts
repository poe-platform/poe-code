import type { InterpreterValue } from "./interpreter.js";

// Accounting-only snapshots: never guest objects or serialized frame cells.
type ScopeDataRoot =
  { readonly value: InterpreterValue } | { readonly values: readonly InterpreterValue[] };
const freeze = Object.freeze;
const defineProperty = Reflect.defineProperty;
const hasOwn = Object.hasOwn;
const records = new WeakMap<object, ScopeDataRoot>();
const nativeGet: typeof records.get = WeakMap.prototype.get.bind(records);
const nativeSet: typeof records.set = WeakMap.prototype.set.bind(records);

// Later native hooks must not receive the registry or its accounting records.
// Discard WeakMap.set's return value so registration cannot reveal the raw map.
export const scopeDataRoots = Object.freeze({
  get: nativeGet,
  set(root: object, data: ScopeDataRoot): void {
    // Records are immutable and have no inherited discriminant fields. The
    // caller supplies a private dense vector, never a guest descendant object.
    const snapshot = hasOwn(data, "value")
      ? freeze({ __proto__: null, value: (data as { value: InterpreterValue }).value })
      : freeze({ __proto__: null, values: freeze((data as { values: readonly InterpreterValue[] }).values) });
    nativeSet(root, snapshot);
  }
});

// Indexed own-property writes cannot expose the vector to a replaced push
// method or an inherited index setter. Measurement must likewise use indices.
export class ScopeDataRootList {
  readonly #values: InterpreterValue[] = [];

  append(value: InterpreterValue): void {
    defineProperty(this.#values, this.#values.length, {
      value, writable: true, enumerable: true, configurable: true
    });
  }

  snapshot(): readonly InterpreterValue[] {
    return freeze(this.#values);
  }
}
