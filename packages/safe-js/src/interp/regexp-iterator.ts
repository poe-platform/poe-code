import type { SandboxRegex } from "./values.js";

declare const regexpIteratorBrand: unique symbol;
export type SandboxRegExpIterator = { readonly [regexpIteratorBrand]: true };
export type RegExpIteratorState = {
  matcher: SandboxRegex | undefined;
  input: string | undefined;
  exhausted: boolean;
};
const states = new WeakMap<object, RegExpIteratorState>();

export function isSandboxRegExpIterator(value: unknown): value is SandboxRegExpIterator {
  return typeof value === "object" && value !== null && states.has(value);
}

export function restoreSandboxRegExpIterator(
  state: RegExpIteratorState,
  target = Object.create(null) as SandboxRegExpIterator
): SandboxRegExpIterator {
  if (!state.exhausted && (state.matcher === undefined || state.input === undefined))
    throw new TypeError("A live RegExp iterator requires its matcher and input.");
  states.set(target, state.exhausted
    ? { matcher: undefined, input: undefined, exhausted: true }
    : { ...state });
  return target;
}

export function regexpIteratorState(value: SandboxRegExpIterator): RegExpIteratorState {
  const state = states.get(value);
  if (state === undefined) throw new TypeError("Expected a RegExp string iterator.");
  return state;
}
