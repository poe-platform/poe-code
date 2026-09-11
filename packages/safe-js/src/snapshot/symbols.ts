import { internalSymbols } from "../interp/internal-symbols.js";
import { wellKnownSymbols } from "../interp/symbols.js";

export type SerializedSymbol = { kind: "symbol"; description?: string; wellKnown?: string };
export type SerializedSymbolProperty<T> = [T, { value: T; enumerable: boolean; writable: boolean; configurable: boolean }];

export function symbolData(value: symbol): SerializedSymbol {
  const wellKnown = Object.keys(wellKnownSymbols).find(key => wellKnownSymbols[key] === value);
  return {
    kind: "symbol",
    ...(wellKnown === undefined
      ? value.description === undefined ? {} : { description: value.description }
      : { wellKnown })
  };
}

export function serializeSymbol(
  value: symbol,
  heapIds: Map<object | symbol, number>,
  heap: Record<string, unknown>
): { kind: "ref"; id: number } {
  let id = heapIds.get(value);
  if (id === undefined) {
    id = heapIds.size + 1;
    heapIds.set(value, id);
    heap[String(id)] = symbolData(value);
  }
  return { kind: "ref", id };
}
export function ownSerializableSymbolKeys(value: object): symbol[] {
  return Object.getOwnPropertySymbols(value).filter(key => !internalSymbols.has(key));
}

export function serializeSymbolProperties<T>(value: object, encode: (value: unknown) => T): Array<SerializedSymbolProperty<T>> {
  return ownSerializableSymbolKeys(value).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) throw new TypeError("Symbol accessor properties cannot be serialized.");
    return [encode(key), { value: encode(descriptor.value), enumerable: descriptor.enumerable === true, writable: descriptor.writable === true, configurable: descriptor.configurable === true }];
  });
}

export function restoreSymbolProperties<T>(target: object, entries: Array<SerializedSymbolProperty<T>> | undefined, decode: (value: T) => unknown): void {
  for (const [key, descriptor] of entries ?? []) {
    const symbol = decode(key);
    if (typeof symbol !== "symbol") throw new TypeError("Expected a symbol property key");
    Object.defineProperty(target, symbol, { ...descriptor, value: decode(descriptor.value) });
  }
}
