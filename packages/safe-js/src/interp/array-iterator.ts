import type { SandboxObject, SandboxValue } from "./values.js";

declare const arrayIteratorBrand: unique symbol;
export type SandboxArrayIterator = SandboxObject & { readonly [arrayIteratorBrand]: true };

export type ArrayIteratorState = {
  source: SandboxValue & object | undefined;
  index: number;
  method: "keys" | "values" | "entries";
};
const states = new WeakMap<object, ArrayIteratorState>();

export function isSandboxArrayIterator(value: unknown): value is SandboxArrayIterator {
  return typeof value === "object" && value !== null && states.has(value);
}

export function restoreSandboxArrayIterator(state: ArrayIteratorState, target: SandboxObject = Object.create(null)): SandboxArrayIterator {
  if (!Number.isSafeInteger(state.index) || state.index < 0 ||
      !["keys", "values", "entries"].includes(state.method) ||
      (state.source !== undefined && (state.source === null || typeof state.source !== "object")))
    throw new TypeError("Invalid Array iterator state.");
  states.set(target, { ...state });
  return target as SandboxArrayIterator;
}

export function arrayIteratorState(value: object): ArrayIteratorState {
  const state = states.get(value);
  if (state === undefined) throw new TypeError("Array iterator next requires an Array iterator receiver.");
  return state;
}
