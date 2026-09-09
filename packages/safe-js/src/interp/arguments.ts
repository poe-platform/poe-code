import type { SandboxObject, SandboxValue } from "./values.js";
import { internalSymbols } from "./internal-symbols.js";
import type { Scope } from "./scope.js";

const sandboxArgumentsBrand = Symbol("SandboxArguments");
internalSymbols.add(sandboxArgumentsBrand);

export type SandboxArguments = SandboxObject & { readonly [sandboxArgumentsBrand]: true };

export const mappedArgumentStates = new WeakMap<SandboxArguments, { scope: Scope; parameters: Map<string, string> }>();
export const unrestrictedArgumentObjects = new WeakSet<object>();

export function createMappedSandboxArguments(
  values: readonly SandboxValue[], names: readonly string[], scope: Scope, callee: SandboxValue
): SandboxArguments {
  const target = createSandboxArguments(values, {callee});
  const parameters = new Map<string, string>();
  const seen = new Set<string>();
  for (let index = names.length - 1; index >= 0; index -= 1) {
    const name = names[index];
    if (!seen.has(name) && index < values.length) parameters.set(String(index), name);
    seen.add(name);
  }
  const parameterValue = (name: string): SandboxValue => {
    const binding = scope.lookup(name);
    if (!binding.found) throw new ReferenceError(`Missing mapped argument binding '${name}'.`);
    return binding.value as SandboxValue;
  };
  const result = new Proxy(target, {
    get(object, key, receiver) {
      const name = typeof key === "string" ? parameters.get(key) : undefined;
      return name === undefined ? Reflect.get(object, key, receiver) : parameterValue(name);
    },
    getOwnPropertyDescriptor(object, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
      const name = typeof key === "string" ? parameters.get(key) : undefined;
      return descriptor === undefined || name === undefined ? descriptor : {...descriptor, value: parameterValue(name)};
    },
    defineProperty(object, key, descriptor) {
      const name = typeof key === "string" ? parameters.get(key) : undefined;
      const effective = name !== undefined && descriptor.writable === false && !("value" in descriptor)
        ? {...descriptor, value: parameterValue(name)} : descriptor;
      if (!Reflect.defineProperty(object, key, effective)) return false;
      if (name !== undefined) {
        if ("get" in descriptor || "set" in descriptor) parameters.delete(key as string);
        else {
          if ("value" in descriptor) scope.assign(name, descriptor.value);
          if (descriptor.writable === false) parameters.delete(key as string);
        }
      }
      return true;
    },
    deleteProperty(object, key) {
      if (!Reflect.deleteProperty(object, key)) return false;
      if (typeof key === "string") parameters.delete(key);
      return true;
    }
  });
  mappedArgumentStates.set(result, {scope, parameters});
  unrestrictedArgumentObjects.add(result);
  return result;
}

export function createSandboxArguments(values: readonly SandboxValue[], unrestricted?: {callee: SandboxValue}): SandboxArguments {
  const result = (unrestricted === undefined ? (function () {
    return arguments;
  })() : Object.defineProperties({}, {
    length: {value: 0, writable: true, configurable: true},
    callee: {value: unrestricted.callee, writable: true, configurable: true},
    [Symbol.iterator]: {value: Array.prototype.values, writable: true, configurable: true}
  })) as unknown as SandboxObject;
  for (let index = 0; index < values.length; index += 1) {
    result[index] = values[index];
  }
  result.length = values.length;
  Object.defineProperty(result, sandboxArgumentsBrand, { value: true });
  if (unrestricted !== undefined) unrestrictedArgumentObjects.add(result);
  return result as unknown as SandboxArguments;
}

export function isSandboxArguments(value: unknown): value is SandboxArguments {
  return typeof value === "object" && value !== null && Object.hasOwn(value, sandboxArgumentsBrand);
}

export function getSandboxArgumentEntries(value: SandboxObject): Array<[string, SandboxValue]> {
  return Object.entries(Object.getOwnPropertyDescriptors(value)).flatMap(([key, descriptor]) =>
    "value" in descriptor ? [[key, descriptor.value]] : []
  );
}

export function copySandboxArgumentProperties(
  source: SandboxObject,
  target: object,
  copyValue: (value: SandboxValue, key: string | symbol) => unknown
): void {
  const names = Object.getOwnPropertyNames(source);
  if (unrestrictedArgumentObjects.has(source) && !names.includes("callee")) Reflect.deleteProperty(target, "callee");
  if (!names.includes("length") || names.indexOf("length") > names.indexOf("callee")) {
    Reflect.deleteProperty(target, "length");
  }
  for (const key of Reflect.ownKeys(source)) {
    if (key === Symbol.iterator || (typeof key === "symbol" && internalSymbols.has(key))) continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, key)!;
    if (!("value" in descriptor)) {
      if (key !== "callee" || unrestrictedArgumentObjects.has(source)) throw new TypeError(`Cannot copy arguments accessor '${String(key)}'.`);
      continue;
    }
    Object.defineProperty(target, key, { ...descriptor, value: copyValue(descriptor.value, key) });
  }
  const iterator = Object.getOwnPropertyDescriptor(source, Symbol.iterator);
  if (iterator === undefined) {
    Reflect.deleteProperty(target, Symbol.iterator);
  } else {
    if (iterator.value !== Array.prototype.values) {
      throw new TypeError("Cannot copy a replaced arguments iterator.");
    }
    Object.defineProperty(target, Symbol.iterator, iterator);
  }
  if (!Object.isExtensible(source)) Object.preventExtensions(target);
}
