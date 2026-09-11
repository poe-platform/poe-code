import { getRegexProperties, type SandboxRegex } from "../interp/values.js";
import { restoreSymbolProperties, serializeSymbolProperties, type SerializedSymbolProperty } from "./symbols.js";

type DataProperty<T> = { value: T; enumerable: boolean; writable: boolean; configurable: boolean };
export type RegexPropertyData<T> = {
  properties?: Record<string, DataProperty<T>>;
  symbolEntries?: Array<SerializedSymbolProperty<T>>;
  extensible?: boolean;
};

export function hasCustomRegexProperties(value: SandboxRegex): boolean {
  const properties = getRegexProperties(value);
  return Reflect.ownKeys(properties).length !== 1 || !Object.isExtensible(properties) ||
    Object.getOwnPropertyDescriptor(properties, "lastIndex")?.writable !== true;
}

export function serializeRegexProperties<T>(value: SandboxRegex, encode: (entry: unknown) => T): RegexPropertyData<T> {
  if (!hasCustomRegexProperties(value)) return {};
  const source = getRegexProperties(value);
  const properties: Record<string, DataProperty<T>> = Object.create(null);
  for (const key of Object.getOwnPropertyNames(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)!;
    if (!("value" in descriptor)) throw new TypeError("RegExp accessor properties cannot be serialized as data.");
    properties[key] = { value: encode(descriptor.value), enumerable: descriptor.enumerable === true,
      configurable: descriptor.configurable === true, writable: descriptor.writable === true };
  }
  const symbolEntries = serializeSymbolProperties(source, encode);
  return { properties, ...(symbolEntries.length === 0 ? {} : { symbolEntries }),
    ...(Object.isExtensible(source) ? {} : { extensible: false }) };
}

export function validateRegexProperties(data: RegexPropertyData<unknown>): void {
  const descriptor = (value: unknown) => {
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
        !Object.hasOwn(value, "value") ||
        !["enumerable", "configurable", "writable"].every(key =>
          Object.hasOwn(value, key) && typeof (value as Record<string, unknown>)[key] === "boolean") ||
        Object.keys(value).some(key => !["value", "enumerable", "configurable", "writable"].includes(key)))
      throw new TypeError("Invalid RegExp data property descriptor.");
  };
  if (data.extensible !== undefined && typeof data.extensible !== "boolean")
    throw new TypeError("Invalid RegExp extensibility.");
  if (data.properties !== undefined) {
    if (typeof data.properties !== "object" || data.properties === null || Array.isArray(data.properties))
      throw new TypeError("Invalid RegExp property data.");
    for (const entry of Object.values(data.properties)) descriptor(entry);
  }
  if (data.symbolEntries !== undefined) {
    if (!Array.isArray(data.symbolEntries)) throw new TypeError("Invalid RegExp symbol properties.");
    for (const entry of data.symbolEntries) {
      if (!Array.isArray(entry) || entry.length !== 2) throw new TypeError("Invalid RegExp symbol property.");
      descriptor(entry[1]);
    }
  }
}

export function restoreRegexProperties<T>(value: SandboxRegex, data: RegexPropertyData<T>, decode: (entry: T) => unknown): void {
  validateRegexProperties(data);
  const properties = getRegexProperties(value);
  for (const [key, descriptor] of Object.entries(data.properties ?? {}))
    Object.defineProperty(properties, key, { ...descriptor, value: decode(descriptor.value) });
  restoreSymbolProperties(properties, data.symbolEntries, decode);
  if (data.extensible === false) Object.preventExtensions(properties);
}
