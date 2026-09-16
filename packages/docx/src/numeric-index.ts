import { InputTypeError } from "./archive.js";

function index(key: string | symbol): number | undefined {
  if (typeof key !== "string" || String(Number(key)) !== key) return undefined;
  const value = Number(key);
  if (!Number.isSafeInteger(value)) throw new InputTypeError("Expected a safe integer sequence index.");
  return value;
}

/** Numeric properties retain sequence lookup and reject arbitrary index writes. */
export function numericSequence<T extends { at(index: number): unknown }>(value: T): T {
  return new Proxy(value, {
    get(target, key, receiver) {
      const resolved = index(key);
      return resolved === undefined ? Reflect.get(target, key, receiver) as unknown : target.at(resolved);
    },
    set(target, key, item, receiver) {
      if (index(key) !== undefined) throw new InputTypeError("Sequence indexes are read-only; use collection operations.");
      return Reflect.set(target, key, item, receiver);
    },
    deleteProperty(target, key) {
      if (index(key) !== undefined) throw new InputTypeError("Sequence indexes are read-only; use collection operations.");
      return Reflect.deleteProperty(target, key);
    },
    defineProperty(target, key, descriptor) {
      if (index(key) !== undefined) throw new InputTypeError("Sequence indexes are read-only; use collection operations.");
      return Reflect.defineProperty(target, key, descriptor);
    }
  });
}
