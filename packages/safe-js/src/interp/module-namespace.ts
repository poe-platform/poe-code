import { markDescriptorObject, setSandboxPrototype } from "./object-model.js";
import type { SandboxObject, SandboxValue } from "./values.js";

const namespaces = new WeakSet<object>();
export const moduleNamespaceRetainedValues = new WeakMap<object, () => Iterable<unknown>>();

export function isSandboxModuleNamespace(value: unknown): value is SandboxObject {
  return value !== null && typeof value === "object" && namespaces.has(value);
}

export function createModuleNamespace(bindings: Record<string, SandboxValue> | ((namespace: SandboxObject) => Record<string, SandboxValue>), read?: (key: string) => SandboxValue, retained?: () => Iterable<unknown>): SandboxObject {
  const target = Object.create(null) as SandboxObject;
  const namespace = new Proxy(target, {
    ownKeys: owner => [...Object.getOwnPropertyNames(owner).sort(),...Object.getOwnPropertySymbols(owner)],
    set: () => false,
    get(owner, key) {
      return read !== undefined && typeof key === "string" && Object.hasOwn(owner, key) ? read(key) : Reflect.get(owner, key);
    },
    getOwnPropertyDescriptor(owner, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(owner, key);
      return descriptor !== undefined && read !== undefined && typeof key === "string"
        ? {...descriptor, value: read(key)} : descriptor;
    },
    defineProperty(owner,key,descriptor) {
      if (typeof key === "symbol") return Reflect.defineProperty(owner,key,descriptor);
      const current = Object.getOwnPropertyDescriptor(owner,key);
      if (current === undefined || descriptor.configurable === true || descriptor.enumerable === false ||
          "get" in descriptor || "set" in descriptor || descriptor.writable === false) return false;
      return !("value" in descriptor) || Object.is(descriptor.value,read === undefined ? current.value : read(key));
    }
  });
  namespaces.add(namespace);
  if (retained !== undefined) moduleNamespaceRetainedValues.set(namespace,retained);
  const entries = typeof bindings === "function" ? bindings(namespace) : bindings;
  for (const key of Object.keys(entries).sort())
    Object.defineProperty(target,key,{value:entries[key],writable:true,enumerable:true});
  Object.defineProperty(target,Symbol.toStringTag,{value:"Module"});
  Object.preventExtensions(target);
  markDescriptorObject(namespace);
  setSandboxPrototype(namespace,null);
  return namespace;
}
