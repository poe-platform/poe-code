import { assertSandboxDataDepth } from "../graph-depth.js";
import { retainedAccessorClosures } from "./accessors.js";
import { getHostObjectMember, isGuestHostObject, isLiveCapability } from "./host-capabilities.js";
import type { Budget } from "./budget.js";
import { boxedValue, isSandboxBox, type BoxedKind, type BoxedPrimitive } from "./boxed.js";
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
const boxedPrototypes = new WeakMap<Budget, Map<BoxedKind, SandboxObject>>();
const intrinsicPrototypeRoots = new WeakMap<Budget, Set<SandboxObject>>();
const intrinsicConstructors = new WeakMap<object, () => boolean>();
const initialBoxedMethods = new WeakMap<object, Map<string, SandboxValue>>();
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
  registerIntrinsicPrototype(budget, prototype, constructor);
}

export function installBoxedPrototype(budget: Budget, prototype: SandboxObject, constructor: SandboxClosure): void {
  let state = boxedPrototypes.get(budget);
  if (state === undefined) boxedPrototypes.set(budget, state = new Map());
  state.set(typeof boxedValue(prototype) as BoxedKind, prototype);
  initialBoxedMethods.set(prototype, new Map(Object.entries(Object.getOwnPropertyDescriptors(prototype)).map(([key, descriptor]) => [key, descriptor.value])));
  registerIntrinsicPrototype(budget, prototype, constructor);
}

export function getBoxedPrototype(value: BoxedPrimitive, budget: Budget): SandboxObject | undefined {
  return boxedPrototypes.get(budget)?.get(typeof value as BoxedKind);
}

export function isDefaultBoxedMethod(value: BoxedPrimitive, key: string, budget: Budget): boolean {
  const prototype = getBoxedPrototype(value, budget);
  return prototype !== undefined && initialBoxedMethods.get(prototype)?.has(key) === true &&
    Object.getOwnPropertyDescriptor(prototype, key)?.value === initialBoxedMethods.get(prototype)?.get(key);
}

export function isIntrinsicConstructor(value: object): boolean {
  return intrinsicConstructors.has(value);
}

function registerIntrinsicPrototype(
  budget: Budget,
  prototype: SandboxObject,
  constructor: SandboxClosure
): void {
  let roots = intrinsicPrototypeRoots.get(budget);
  if (roots === undefined) intrinsicPrototypeRoots.set(budget, (roots = new Set()));
  roots.add(prototype);
  const records = [prototype, constructor]
    .map((target) => ({
      target,
      value: isGuestClosure(target) ? materializeFunctionProperties(target) : target,
      prototype: getSandboxPrototype(target),
      explicit: hasExplicitSandboxPrototype(target)
    }))
    .map((record) => ({
      ...record,
      descriptors: new Map(Object.entries(Object.getOwnPropertyDescriptors(record.value)))
    }));
  const unchanged = (
    before: PropertyDescriptor | undefined,
    after: PropertyDescriptor | undefined
  ): boolean =>
    before !== undefined &&
    after !== undefined &&
    Object.is(before.value, after.value) &&
    before.get === after.get &&
    before.set === after.set &&
    before.writable === after.writable &&
    before.configurable === after.configurable &&
    before.enumerable === after.enumerable;
  intrinsicConstructors.set(constructor, () =>
    records.every(({ target, value, descriptors, prototype: parent, explicit }) => {
      const current = Object.getOwnPropertyDescriptors(value);
      return (
        getSandboxPrototype(target) === parent &&
        hasExplicitSandboxPrototype(target) === explicit &&
        Object.keys(current).length === descriptors.size &&
        Object.keys(current).every((key) => unchanged(descriptors.get(key), current[key]))
      );
    })
  );
  budget.setRetainedValues(prototype, () =>
    records.flatMap(({ target, value, descriptors, prototype: parent }) => [
      ...(getSandboxPrototype(target) === parent
        ? []
        : [getSandboxPrototype(target) as SandboxValue]),
      ...Object.entries(Object.getOwnPropertyDescriptors(value)).flatMap(([key, descriptor]) =>
        unchanged(descriptors.get(key), descriptor)
          ? []
          : [key, descriptor.value, ...retainedAccessorClosures(descriptor)]
      )
    ])
  );
}

export function releaseObjectPrototype(budget: Budget): void {
  for (const prototype of intrinsicPrototypeRoots.get(budget) ?? []) budget.setRetainedValues(prototype, undefined);
  intrinsicPrototypeRoots.delete(budget);
  boxedPrototypes.delete(budget);
  intrinsicPrototypes.delete(budget);
}

export function getSandboxPrototype(value: object, budget?: Budget): object | null {
  if (prototypes.has(value)) return prototypes.get(value) ?? null;
  if (budget !== undefined && isSandboxBox(value)) {
    const prototype = getBoxedPrototype(boxedValue(value), budget);
    if (prototype !== undefined && prototype !== value) return prototype;
  }
  return budget !== undefined && !isSandboxClosure(value) && isPrototypeRecord(value)
    ? intrinsicPrototypes.get(budget) ?? null
    : null;
}

export function hasExplicitSandboxPrototype(value: object): boolean {
  return prototypes.has(value);
}

export function getSandboxPropertyDescriptor(
  value: SandboxValue,
  key: string | number,
  budget?: Budget
): PropertyDescriptor | undefined {
  const hostProperties = isSandboxClosure(value) ? value.properties : undefined;
  if (isSandboxClosure(value) && !isGuestClosure(value))
    return hostProperties === undefined
      ? undefined
      : Object.getOwnPropertyDescriptor(hostProperties, key);
  let current = value;
  let depth = 0;
  while (
    typeof current === "object" &&
    current !== null &&
    (Array.isArray(current) || isPrototypeRecord(current))
  ) {
    const properties = isGuestClosure(current) ? getGuestFunctionProperties(current) : current;
    const descriptor =
      properties === undefined ? undefined : Object.getOwnPropertyDescriptor(properties, key);
    if (descriptor !== undefined) return descriptor;
    current = getSandboxPrototype(current, budget) as SandboxValue;
    if (current !== null) {
      budget?.visitNode();
      assertSandboxDataDepth(++depth);
    }
  }
  return undefined;
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
    if (isGuestClosure(current)) {
      const entry = getGuestFunctionProperty(current, String(key));
      if (entry !== undefined || Object.hasOwn(current.properties ?? {}, String(key))) return entry;
    } else if (isSandboxClosure(current)) {
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
    if (!isSandboxClosure(current) && Object.hasOwn(current, String(key))) return (current as SandboxObject)[String(key)];
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
      "Prototype links require ordinary sandbox objects or guest functions."
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
  if (isGuestClosure(value)) return true;
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
  if (isSandboxBox(value)) return false;
  return (
    descriptorObjects.has(value) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (descriptor) => !descriptor.enumerable || !descriptor.configurable || !descriptor.writable
    )
  );
}
