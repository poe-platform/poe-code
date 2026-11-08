import type { Budget } from "../budget.js";
import { arrayIteratorState, isSandboxArrayIterator } from "../array-iterator.js";
import { typedArrayStorage, isNumericTypedArray } from "../typed-array.js";
import { readPropertyDescriptor } from "../accessors.js";
import { getSandboxPropertyDescriptor, getSandboxPrototype, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { createIteratorResult } from "../iterator-result.js";
import { sandboxNumber } from "../string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

export async function nextArrayIterator(value: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<SandboxValue> {
  if (!isSandboxArrayIterator(value)) throw new TypeError("Array iterator next requires an Array iterator receiver.");
  const state = arrayIteratorState(value);
  const source = state.source;
  if (source === undefined) return createIteratorResult(undefined, true, budget);
  const index = state.index;
  const release = retainValues(budget, () => [value, source]);
  const read = (key: string) => context?.getProperty !== undefined ? context.getProperty(source, key)
    : readPropertyDescriptor((isNumericTypedArray(source) ? Object.getOwnPropertyDescriptor(source, key) : undefined)
      ?? getSandboxPropertyDescriptor(source, key, budget) ?? { value: undefined }, source, context);
  try {
    budget.visitNode();
    const number = isNumericTypedArray(source) ? typedArrayStorage(source, true).length
      : await sandboxNumber(await read("length"), budget, context);
    const length = Number.isNaN(number) || number <= 0 ? 0 : Math.min(Math.trunc(number), Number.MAX_SAFE_INTEGER);
    if (index >= length) {
      state.source = undefined;
      return createIteratorResult(undefined, true, budget);
    }
    state.index = index + 1;
    if (state.method === "keys") return createIteratorResult(index, false, budget);
    const entry = await read(String(index));
    if (state.method === "entries") {
      budget.allocateArrayLength(2);
      const pair = [index, entry];
      const prototype = getSandboxPrototype(pair, budget);
      if (prototype !== null) setSandboxPrototype(pair, prototype, budget);
      return createIteratorResult(pair, false, budget);
    }
    return createIteratorResult(entry, false, budget);
  } finally {
    release();
  }
}
