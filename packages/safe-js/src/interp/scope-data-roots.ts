import type { InterpreterValue } from "./interpreter.js";
import type { SandboxClosure, SandboxObject, SandboxValue } from "./values.js";

export type DeferredArgumentsData = {
  readonly read: () => SandboxObject | undefined;
  readonly capture: () => {
    readonly units: number;
    readonly iterator: symbol;
    readonly references: readonly InterpreterValue[];
  } | undefined;
};

export type DeferredFunctionData = {
  readonly chargeIdentity: object;
  readonly read: () => SandboxClosure | undefined;
  readonly collect: (append: (value: SandboxValue) => void) => void;
};

// Accounting-only snapshots: never guest objects or serialized frame cells.
type ScopeDataRoot =
  { readonly value: InterpreterValue } | { readonly values: readonly InterpreterValue[] } |
  { readonly arguments: DeferredArgumentsData } |
  { readonly deferred: DeferredFunctionData };
const freeze = Object.freeze;
const setPrototypeOf = Object.setPrototypeOf;
const defineProperty = Reflect.defineProperty;
const hasOwn = Object.hasOwn;
const records = new WeakMap<object, ScopeDataRoot>();
const nativeGet: typeof records.get = WeakMap.prototype.get.bind(records);
const nativeSet: typeof records.set = WeakMap.prototype.set.bind(records);
const freshRootDescriptor = {
  __proto__: null,
  value: undefined as InterpreterValue,
  writable: true,
  enumerable: true,
  configurable: true
};

// Fresh collectors can write millions of roots. Reuse a private descriptor,
// bypass inherited index setters, and release its guest reference after writing.
export function appendScopeDataRoot(values: InterpreterValue[], value: InterpreterValue): void {
  // Optional function captures are usually absent and retain no graph data.
  if (value === undefined) return;
  const index = values.length;
  freshRootDescriptor.value = value;
  try {
    if (!defineProperty(values, index, freshRootDescriptor)) throw new TypeError("Cannot append scope data root.");
  } finally {
    freshRootDescriptor.value = undefined;
  }
}

// Later native hooks must not receive the registry or its accounting records.
// Discard WeakMap.set's return value so registration cannot reveal the raw map.
export const scopeDataRoots = Object.freeze({
  get: nativeGet,
  set(root: object, data: ScopeDataRoot): void {
    // Records are immutable and have no inherited discriminant fields. The
    // caller supplies a private dense vector, never a guest descendant object.
    // Clear the prototype after creating own fields: null-prototype literals
    // use dictionary storage in V8, slowing every accounting discriminant read.
    const snapshot = hasOwn(data, "value")
      ? freeze(setPrototypeOf({ value: (data as { value: InterpreterValue }).value }, null))
      : hasOwn(data, "arguments")
        ? freeze(setPrototypeOf({ arguments: freeze((data as Extract<ScopeDataRoot, {arguments: unknown}>).arguments) }, null))
      : hasOwn(data, "deferred")
        ? freeze(setPrototypeOf({ deferred: freeze((data as Extract<ScopeDataRoot, {deferred: unknown}>).deferred) }, null))
      : freeze(setPrototypeOf({ values: freeze((data as { values: readonly InterpreterValue[] }).values) }, null));
    nativeSet(root, snapshot);
  }
});

// Private null-prototype vectors need neither descriptor allocations nor native
// array methods. Indexed reads/writes cannot invoke inherited prototype hooks.
export class ScopeDataRootList {
  readonly #values: InterpreterValue[] = setPrototypeOf([], null);

  append(value: InterpreterValue): void {
    this.#values[this.#values.length] = value;
  }

  snapshot(): readonly InterpreterValue[] {
    return freeze(this.#values);
  }
}
