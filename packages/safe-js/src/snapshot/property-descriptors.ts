import { accessorAdapter, accessorClosure } from "../interp/accessors.js";
import { internalSymbols } from "../interp/internal-symbols.js";
import { markDescriptorObject } from "../interp/object-model.js";
import { isSandboxClosure } from "../interp/values.js";

type Descriptor<T> = { enumerable: boolean; configurable: boolean } & (
  { kind: "data"; value: T; writable: boolean } |
  { kind: "accessor"; get: T; set: T }
);

export type PropertyDescriptorData<T> = {
  properties: Array<[T, Descriptor<T>]>;
  extensible: boolean;
};

export function serializePropertyDescriptors<T>(target: object, encode: (value: unknown) => T): PropertyDescriptorData<T> {
  return {
    properties: Reflect.ownKeys(target).filter(key => typeof key !== "symbol" || !internalSymbols.has(key)).map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
      const flags = { enumerable: descriptor.enumerable === true, configurable: descriptor.configurable === true };
      return [encode(key), "value" in descriptor
        ? { kind: "data", ...flags, value: encode(descriptor.value), writable: descriptor.writable === true }
        : { kind: "accessor", ...flags, get: encode(accessorClosure(descriptor.get)), set: encode(accessorClosure(descriptor.set)) }];
    }),
    extensible: Object.isExtensible(target)
  };
}

function record(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Invalid property descriptor record.");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== names.length ||
      names.some(name => !Object.hasOwn(descriptors, name) || !("value" in descriptors[name])))
    throw new TypeError("Invalid property descriptor fields.");
  return Object.fromEntries(names.map(name => [name, descriptors[name].value]));
}

export function restorePropertyDescriptors<T>(target: object, raw: unknown, decode: (value: T) => unknown): void {
  const data = record(raw, ["properties", "extensible"]);
  if (!Array.isArray(data.properties) || typeof data.extensible !== "boolean")
    throw new TypeError("Invalid property descriptor state.");
  const decoded = new Map<PropertyKey, PropertyDescriptor>();
  for (const entry of data.properties) {
    if (!Array.isArray(entry) || entry.length !== 2)
      throw new TypeError("Invalid property descriptor entry.");
    const key = decode(entry[0]);
    if ((typeof key !== "string" && typeof key !== "symbol") || (typeof key === "symbol" && internalSymbols.has(key)))
      throw new TypeError("Invalid property key.");
    if (decoded.has(key)) throw new TypeError("Duplicate property key.");
    const kind = entry[1] !== null && typeof entry[1] === "object"
      ? Object.getOwnPropertyDescriptor(entry[1], "kind")?.value : undefined;
    if (kind !== "data" && kind !== "accessor") throw new TypeError("Invalid property descriptor kind.");
    const descriptor = record(entry[1], kind === "data"
      ? ["kind", "value", "writable", "enumerable", "configurable"]
      : ["kind", "get", "set", "enumerable", "configurable"]);
    if (typeof descriptor.enumerable !== "boolean" || typeof descriptor.configurable !== "boolean" ||
        (kind === "data" && typeof descriptor.writable !== "boolean"))
      throw new TypeError("Invalid property descriptor flags.");
    const result: PropertyDescriptor = { enumerable: descriptor.enumerable, configurable: descriptor.configurable };
    if (kind === "data") {
      result.value = decode(descriptor.value as T);
      result.writable = descriptor.writable as boolean;
    } else {
      for (const accessor of ["get", "set"] as const) {
        const closure = decode(descriptor[accessor] as T);
        if (closure !== undefined && !isSandboxClosure(closure))
          throw new TypeError("Property accessors require a sandbox closure.");
        result[accessor] = closure === undefined ? undefined : accessorAdapter(closure, accessor);
      }
    }
    decoded.set(key, result);
  }

  // Preflight native descriptor compatibility and key ordering before touching
  // the fresh realm's actual intrinsic object. No property values are read.
  const trial = Object.defineProperties(Object.create(null), Object.getOwnPropertyDescriptors(target));
  if (!Object.isExtensible(target)) Object.preventExtensions(trial);
  applyDescriptors(trial, decoded, data.extensible);
  applyDescriptors(target, decoded, data.extensible);
  markDescriptorObject(target);
}

function keyGroup(key: PropertyKey): "index" | "string" | "symbol" {
  if (typeof key === "symbol") return "symbol";
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 0xffffffff && String(index) === key ? "index" : "string";
}

function applyDescriptors(target: object, descriptors: Map<PropertyKey, PropertyDescriptor>, extensible: boolean): void {
  if (extensible && !Object.isExtensible(target)) throw new TypeError("Cannot restore extensibility.");
  const original = Reflect.ownKeys(target).filter(key => typeof key !== "symbol" || !internalSymbols.has(key));
  const keep = new Set<PropertyKey>();
  for (const group of ["index", "string", "symbol"] as const) {
    const positions = new Map(original.filter(key => keyGroup(key) === group).map((key, index) => [key, index]));
    let previous = -1;
    for (const key of descriptors.keys()) {
      if (keyGroup(key) !== group) continue;
      const position = positions.get(key as string | symbol);
      if (group === "index") {
        if (position !== undefined) keep.add(key);
      } else {
        if (position === undefined || position <= previous) break;
        keep.add(key);
        previous = position;
      }
    }
  }
  for (const key of original)
    if (!keep.has(key) && !Reflect.deleteProperty(target, key))
      throw new TypeError("Cannot restore nonconfigurable property order or deletion.");
  for (const [key, descriptor] of descriptors) Object.defineProperty(target, key, descriptor);
  if (!extensible) Object.preventExtensions(target);
}
