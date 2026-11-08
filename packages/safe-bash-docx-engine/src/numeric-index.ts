import { InputTypeError } from "./archive.js";
import { BoundsError } from "./model-errors.js";

/** Owned model snapshots retain array protocols with checked numeric access. */
export function snapshotSequence<T>(items: readonly T[]): readonly T[] {
  const values = Array.from(items);
  Object.defineProperties(values, {
    at: { value(position: number): T {
      if (!Number.isSafeInteger(position)) throw new InputTypeError("Expected a safe integer sequence index.");
      const resolved = position < 0 ? values.length + position : position;
      if (resolved < 0 || resolved >= values.length) throw new BoundsError("Sequence index is out of bounds.");
      return values[resolved]!;
    } },
    slice: { value(start = 0, end = values.length): readonly T[] {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) throw new InputTypeError("Expected safe integer slice bounds.");
      return snapshotSequence(Array.prototype.slice.call(values, start, end) as T[]);
    } }
  });
  return numericSequence(Object.freeze(values));
}

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
      if (resolved !== undefined && resolved < 0) throw new BoundsError("Sequence index is out of bounds.");
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
