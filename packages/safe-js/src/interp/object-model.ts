import { assertSandboxDataDepth } from "../graph-depth.js";
import { getHostObjectMember, isGuestHostObject, isLiveCapability } from "./host-capabilities.js";
import type { Budget } from "./budget.js";
import {
  isSandboxClosure,
  isSandboxGenerator,
  isSandboxMap,
  isSandboxPromise,
  isSandboxRegex,
  isSandboxSet,
  type SandboxClosure,
  type SandboxObject,
  type SandboxValue
} from "./values.js";

const guestClosures = new WeakSet<object>();
const functionProperties = new WeakMap<object, SandboxObject>();
const prototypes = new WeakMap<object, object | null>();
const intrinsicPrototypes = new WeakMap<Budget, SandboxObject>();
const intrinsicConstructors = new WeakMap<object, () => boolean>();
const descriptorObjects = new WeakSet<object>();

export function registerGuestClosure(closure: SandboxClosure): void {
  guestClosures.add(closure);
}

export function isGuestClosure(value: unknown): value is SandboxClosure {
  return typeof value === "object" && value !== null && guestClosures.has(value);
}

export function getGuestFunctionProperties(closure: SandboxClosure): SandboxObject | undefined {
  return functionProperties.get(closure);
}

export function materializeFunctionProperties(closure: SandboxClosure): SandboxObject {
  if (!isGuestClosure(closure)) throw new TypeError("Host function properties are read only.");
  const existing = functionProperties.get(closure);
  if (existing !== undefined) return existing;
  const properties = Object.create(null) as SandboxObject;
  Object.defineProperties(properties, {
    length: { value: closure.length ?? 0, configurable: true },
    name: { value: closure.name ?? "", configurable: true }
  });
  if (closure.construct !== undefined && closure.boundTarget === undefined) {
    const prototype = Object.create(null) as SandboxObject;
    Object.defineProperty(prototype, "constructor", {
      value: closure,
      writable: true,
      configurable: true
    });
    descriptorObjects.add(prototype);
    Object.defineProperty(properties, "prototype", { value: prototype, writable: true });
  }
  descriptorObjects.add(properties);
  functionProperties.set(closure, properties);
  return properties;
}

export function getGuestFunctionProperty(closure: SandboxClosure, key: string): SandboxValue {
  let properties = functionProperties.get(closure);
  if (properties === undefined) {
    if (key === "length") return closure.length ?? 0;
    if (key === "name") return closure.name ?? "";
    if (
      key === "prototype" &&
      closure.construct !== undefined &&
      closure.boundTarget === undefined
    ) {
      properties = materializeFunctionProperties(closure);
    }
  }
  return properties === undefined
    ? undefined
    : Object.getOwnPropertyDescriptor(properties, key)?.value;
}

export function installObjectPrototype(budget: Budget, prototype: SandboxObject, constructor: SandboxClosure): void {
  prototypes.set(prototype, null);
  intrinsicPrototypes.set(budget, prototype);
  const records = [prototype, materializeFunctionProperties(constructor)].map(value => ({
    value, descriptors: new Map(Object.entries(Object.getOwnPropertyDescriptors(value)))
  }));
  const unchanged = (before: PropertyDescriptor | undefined, after: PropertyDescriptor | undefined): boolean =>
    before !== undefined && after !== undefined && before.value === after.value &&
    before.writable === after.writable && before.configurable === after.configurable && before.enumerable === after.enumerable;
  intrinsicConstructors.set(constructor, () => records.every(({ value, descriptors }) => {
    const current = Object.getOwnPropertyDescriptors(value);
    return Object.keys(current).length === descriptors.size &&
      Object.keys(current).every(key => unchanged(descriptors.get(key), current[key]));
  }));
  budget.setRetainedValues(prototype, () => records.flatMap(({ value, descriptors }) =>
    Object.entries(Object.getOwnPropertyDescriptors(value)).flatMap(([key, descriptor]) =>
      unchanged(descriptors.get(key), descriptor) ? [] : [key, descriptor.value])));
}

export function releaseObjectPrototype(budget: Budget): void {
  const prototype = intrinsicPrototypes.get(budget);
  if (prototype !== undefined) budget.setRetainedValues(prototype, undefined);
  intrinsicPrototypes.delete(budget);
}

export function getSandboxPrototype(value: object, budget?: Budget): object | null {
  if (prototypes.has(value)) return prototypes.get(value) ?? null;
  return budget !== undefined && isPrototypeRecord(value)
    ? intrinsicPrototypes.get(budget) ?? null
    : null;
}

export function hasExplicitSandboxPrototype(value: object): boolean {
  return prototypes.has(value);
}

export function getSandboxDataProperty(
  value: SandboxValue,
  key: string | number,
  budget?: Budget
): SandboxValue {
  let current = value;
  let depth = 0;
  while (typeof current === "object" && current !== null) {
    if (isGuestHostObject(current)) return getHostObjectMember(current, String(key));
    if (isGuestClosure(current)) return getGuestFunctionProperty(current, String(key));
    if (isSandboxClosure(current)) {
      const properties = current.properties;
      return properties !== undefined && Object.hasOwn(properties, String(key))
        ? properties[String(key)]
        : undefined;
    }
    if (
      isSandboxMap(current) ||
      isSandboxSet(current) ||
      isSandboxPromise(current) ||
      isSandboxRegex(current) ||
      isSandboxGenerator(current)
    )
      return undefined;
    if (Object.hasOwn(current, String(key))) return (current as SandboxObject)[String(key)];
    current = getSandboxPrototype(current, budget) as SandboxValue;
    if (current !== null) {
      budget?.visitNode();
      assertSandboxDataDepth(++depth);
    }
  }
  return undefined;
}

export function setSandboxPrototype(
  value: object,
  prototype: object | null,
  budget?: Budget
): void {
  if (budget !== undefined && intrinsicPrototypes.get(budget) === value && prototype !== null) {
    throw new TypeError("Object.prototype has an immutable null prototype.");
  }
  if (!isPrototypeRecord(value) || (prototype !== null && !isPrototypeRecord(prototype))) {
    throw new TypeError(
      "Prototype links require ordinary sandbox objects; callable and exotic prototype chains are not supported."
    );
  }
  if (prototypes.has(value) && getSandboxPrototype(value, budget) === prototype) return;
  if (!Object.isExtensible(isGuestClosure(value) ? materializeFunctionProperties(value) : value)) {
    throw new TypeError("Cannot change the prototype of a non-extensible object.");
  }
  let depth = 0;
  for (let current = prototype; current !== null; current = getSandboxPrototype(current, budget)) {
    budget?.visitNode();
    assertSandboxDataDepth(depth++);
    if (current === value) throw new TypeError("Cyclic prototype value.");
  }
  prototypes.set(value, prototype);
}

function isPrototypeRecord(value: object): boolean {
  if (isGuestHostObject(value)) return false;
  if (
    isSandboxClosure(value) ||
    isSandboxGenerator(value) ||
    isSandboxMap(value) ||
    isSandboxPromise(value) ||
    isSandboxRegex(value) ||
    isSandboxSet(value)
  )
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

export function markDescriptorObject(value: object): void {
  descriptorObjects.add(value);
}

export function hasManagedDescriptors(value: object): boolean {
  return descriptorObjects.has(value);
}

export function hasGuestObjectState(value: object): boolean {
  const intrinsicUnchanged = intrinsicConstructors.get(value);
  if (intrinsicUnchanged !== undefined) return !intrinsicUnchanged();
  if (isLiveCapability(value)) return true;
  if (functionProperties.has(value) || prototypes.has(value)) return true;
  return (
    descriptorObjects.has(value) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (descriptor) => !descriptor.enumerable || !descriptor.configurable || !descriptor.writable
    )
  );
}
