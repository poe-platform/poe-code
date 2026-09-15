import { types } from "node:util";

const admittedSymbols = new WeakMap<Promise<unknown>, readonly symbol[]>();

/**
 * Admit caller-owned, own symbol data properties at the native Promise boundary.
 * This replaces the previous admission list. It grants authority by key identity;
 * callers must never supply host async-context keys. Accessors are not admitted.
 * Descriptors are read at import time, without invoking getters. No host symbols
 * are discovered automatically, and registration does not mutate the Promise.
 */
export function admitNativePromiseProperties<T extends Promise<unknown>>(value: T, keys: readonly symbol[]): T {
  if (!types.isPromise(value)) throw new TypeError("Property admission requires a native Promise.");
  const admitted = [...new Set(keys)];
  for (const key of admitted) {
    if (typeof key !== "symbol") throw new TypeError("Promise property admission requires symbol keys.");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor))
      throw new TypeError("Admitted Promise properties must be own data properties.");
  }
  admittedSymbols.set(value, admitted);
  return value;
}

export function nativePromiseDataProperties(value: Promise<unknown>): Array<readonly [string | symbol, PropertyDescriptor]> {
  const properties: Array<readonly [string | symbol, PropertyDescriptor]> = Object.getOwnPropertyNames(value).flatMap(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return "value" in descriptor ? [[key, descriptor] as const] : [];
  });
  const admitted = new Set(admittedSymbols.get(value) ?? []);
  if (admitted.size === 0) return properties;
  const symbols = Object.getOwnPropertySymbols(value).filter(key => admitted.has(key));
  if (symbols.length !== admitted.size) throw new TypeError("Admitted Promise properties must remain own data properties.");
  for (const key of symbols) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor))
      throw new TypeError("Admitted Promise properties must remain own data properties.");
    properties.push([key, descriptor]);
  }
  return properties;
}
