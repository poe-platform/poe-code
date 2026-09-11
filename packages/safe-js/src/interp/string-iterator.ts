import type { Budget } from "./budget.js";
import type { SandboxObject, SandboxValue } from "./values.js";
import { createIteratorResult } from "./iterator-result.js";

export type StringIteratorState = { input: string | undefined; index: number };
declare const stringIteratorBrand: unique symbol;
export type SandboxStringIterator = SandboxObject & { readonly [stringIteratorBrand]: true };
const states = new WeakMap<object, StringIteratorState>();

export function isSandboxStringIterator(value: unknown): value is SandboxStringIterator {
  return typeof value === "object" && value !== null && states.has(value);
}

export function restoreSandboxStringIterator(state: StringIteratorState, target: SandboxObject = Object.create(null)): SandboxStringIterator {
  validateStringIteratorState(state);
  states.set(target, { ...state });
  return target as SandboxStringIterator;
}

export function validateStringIteratorState(state: StringIteratorState): void {
  if (!Number.isSafeInteger(state.index) || state.index < 0 ||
      (state.input === undefined ? state.index !== 0 : typeof state.input !== "string" || state.index > state.input.length ||
        (state.index > 0 && state.input.codePointAt(state.index - 1)! > 0xffff)))
    throw new TypeError("Invalid String iterator state.");
}

export function stringIteratorState(value: object): StringIteratorState {
  const state = states.get(value);
  if (state === undefined) throw new TypeError("String iterator next requires a String iterator receiver.");
  return state;
}

export function nextStringIterator(value: SandboxValue, budget: Budget): SandboxValue {
  if (!isSandboxStringIterator(value)) throw new TypeError("String iterator next requires a String iterator receiver.");
  const state = stringIteratorState(value);
  budget.visitNode();
  if (state.input === undefined) return createIteratorResult(undefined, true, budget);
  if (state.index >= state.input.length) {
    state.input = undefined;
    state.index = 0;
    return createIteratorResult(undefined, true, budget);
  }
  const width = state.input.codePointAt(state.index)! > 0xffff ? 2 : 1;
  const entry = budget.allocateString(state.input.slice(state.index, state.index + width));
  state.index += width;
  return createIteratorResult(entry, false, budget);
}
