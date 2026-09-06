import { dateDataProperties, serializedDateTime } from "../interp/date.js";
import { restoreSymbolProperties, serializeSymbolProperties, type SerializedSymbolProperty } from "./symbols.js";

type DataProperty<T> = { value: T; enumerable: boolean; writable: boolean; configurable: boolean };
export type SerializedDate<T> = {
  kind: "date";
  time: number | null;
  properties?: Record<string, DataProperty<T>>;
  symbolEntries?: Array<SerializedSymbolProperty<T>>;
  extensible?: boolean;
};

export function serializeDate<T>(value: Date, encode: (value: unknown) => T): SerializedDate<T> {
  const properties: Record<string, DataProperty<T>> = Object.create(null);
  for (const [key, descriptor] of dateDataProperties(value)) {
    if (typeof key !== "string") continue;
    properties[key] = { value: encode(descriptor.value), enumerable: descriptor.enumerable === true, writable: descriptor.writable === true, configurable: descriptor.configurable === true };
  }
  const symbolEntries = serializeSymbolProperties(value, encode);
  return {
    kind: "date", time: serializedDateTime(value),
    ...(Object.keys(properties).length === 0 ? {} : { properties }),
    ...(symbolEntries.length === 0 ? {} : { symbolEntries }),
    ...(Object.isExtensible(value) ? {} : { extensible: false })
  };
}

export function restoreDateProperties<T>(value: Date, data: SerializedDate<T>, decode: (value: T) => unknown): void {
  for (const [key, descriptor] of Object.entries(data.properties ?? {})) {
    Object.defineProperty(value, key, { ...descriptor, value: decode(descriptor.value) });
  }
  restoreSymbolProperties(value, data.symbolEntries, decode);
  if (data.extensible === false) Object.preventExtensions(value);
}
