import { assertSandboxDataDepth } from "../graph-depth.js";
import { getIntrinsicIdentity, registerBuiltinIdentities, releaseIntrinsicIdentities } from "./intrinsics.js";
import { releaseTemplateObjects } from "./template-objects.js";
import { isSandboxDate } from "./date.js";
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
  getRegexProperties,
  getCollectionProperties,
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
const regexPrototypes = new WeakMap<Budget, SandboxObject>();
const collectionPrototypes = new WeakMap<Budget, Map<"Map" | "Set", SandboxObject>>();
const initialRegexDescriptors = new WeakMap<Budget, PropertyDescriptorMap>();
const intrinsicPrototypeRoots = new WeakMap<Budget, Set<object>>();
const intrinsicConstructors = new WeakMap<object, () => boolean>();
const intrinsicFunctions = new WeakSet<object>();
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

export function getGuestFunctionProperty(closure: SandboxClosure, key: PropertyKey): SandboxValue {
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

export function installBoxedPrototype(budget: Budget, prototype: SandboxObject, constructor: SandboxClosure, kind: BoxedKind = typeof boxedValue(prototype) as BoxedKind): void {
  let state = boxedPrototypes.get(budget);
  if (state === undefined) boxedPrototypes.set(budget, state = new Map());
  state.set(kind, prototype);
  initialBoxedMethods.set(prototype, new Map(Object.entries(Object.getOwnPropertyDescriptors(prototype)).map(([key, descriptor]) => [key, descriptor.value])));
  registerIntrinsicPrototype(budget, prototype, constructor);
}

export function getBoxedPrototype(value: BoxedPrimitive, budget: Budget): SandboxObject | undefined {
  return boxedPrototypes.get(budget)?.get(typeof value as BoxedKind);
}

export function installRegexPrototype(budget: Budget, prototype: SandboxObject, constructor: SandboxClosure): void {
  regexPrototypes.set(budget, prototype);
  initialRegexDescriptors.set(budget, Object.getOwnPropertyDescriptors(prototype));
  registerIntrinsicPrototype(budget, prototype, constructor);
}

export function installCollectionPrototype(budget: Budget, name: "Map" | "Set", prototype: SandboxObject, constructor: SandboxClosure): void {
  let state = collectionPrototypes.get(budget);
  if (state === undefined) collectionPrototypes.set(budget, state = new Map());
  state.set(name, prototype);
  registerIntrinsicPrototype(budget, prototype, constructor);
}

export function hasRegexPropertyOverride(value: SandboxValue, keys: readonly string[], budget: Budget): boolean {
  const initial = initialRegexDescriptors.get(budget);
  const prototype = regexPrototypes.get(budget);
  const defaultPrototype = isSandboxRegex(value) && prototype !== undefined && getSandboxPrototype(value, budget) === prototype;
  return keys.some(key => {
    const current = defaultPrototype
      ? Object.getOwnPropertyDescriptor(getRegexProperties(value), key) ?? Object.getOwnPropertyDescriptor(prototype, key)
      : getSandboxPropertyDescriptor(value, key, budget);
    const expected = initial?.[key];
    return expected === undefined ? current !== undefined : current === undefined ||
      current.value !== expected.value || current.get !== expected.get || current.set !== expected.set;
  });
}

export function isDefaultBoxedMethod(value: BoxedPrimitive, key: string, budget: Budget): boolean {
  const prototype = getBoxedPrototype(value, budget);
  return prototype !== undefined && initialBoxedMethods.get(prototype)?.has(key) === true &&
    Object.getOwnPropertyDescriptor(prototype, key)?.value === initialBoxedMethods.get(prototype)?.get(key);
}

export function isIntrinsicFunction(value: object): boolean {
  return intrinsicFunctions.has(value);
}

function registerIntrinsicPrototype(
  budget: Budget,
  prototype: SandboxObject,
  constructor: SandboxClosure
): void {
  if (constructor.name === undefined) throw new TypeError("Intrinsic constructors require an installation name.");
  registerBuiltinIdentities(budget, { [constructor.name]: constructor });
  const methods = [prototype, materializeFunctionProperties(constructor)]
    .flatMap(owner => Reflect.ownKeys(owner).flatMap(key => {
      const descriptor = Object.getOwnPropertyDescriptor(owner, key)!;
      return [descriptor.value, ...retainedAccessorClosures(descriptor)];
    }))
    .filter(isGuestClosure);
  trackIntrinsicState(budget, prototype, constructor, [prototype, constructor, ...methods]);
}

export function registerIntrinsicFunction(budget: Budget, closure: SandboxClosure): void {
  if (closure.name === undefined) throw new TypeError("Intrinsic functions require an installation name.");
  if (getIntrinsicIdentity(closure) === undefined)
    registerBuiltinIdentities(budget, { [closure.name]: closure });
  trackIntrinsicState(budget, closure, closure, [closure]);
}

export function registerIntrinsicObject(budget: Budget, value: SandboxObject): void {
  const methods = Object.values(Object.getOwnPropertyDescriptors(value))
    .map(descriptor => descriptor.value).filter(isGuestClosure);
  trackIntrinsicState(budget, value, value, [value, ...methods]);
}

function trackIntrinsicState(
  budget: Budget,
  root: object,
  owner: object,
  targets: Array<SandboxObject | SandboxClosure>
): void {
  let roots = intrinsicPrototypeRoots.get(budget);
  if (roots === undefined) intrinsicPrototypeRoots.set(budget, (roots = new Set()));
  roots.add(root);
  const records = [...new Set(targets)]
    .map((target) => ({
      target,
      value: isGuestClosure(target) ? materializeFunctionProperties(target) : target,
      prototype: getSandboxPrototype(target),
      explicit: hasExplicitSandboxPrototype(target)
    }))
    .map((record) => ({
      ...record,
      extensible: Object.isExtensible(record.value),
      descriptors: new Map(Reflect.ownKeys(record.value).map(key => [key, Object.getOwnPropertyDescriptor(record.value, key)!]))
    }));
  for (const { target } of records)
    if (isGuestClosure(target)) intrinsicFunctions.add(target);
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
  intrinsicConstructors.set(owner, () =>
    records.every(({ target, value, descriptors, prototype: parent, explicit, extensible }) => {
      const current = Object.getOwnPropertyDescriptors(value);
      return (
        getSandboxPrototype(target) === parent &&
        Object.isExtensible(value) === extensible &&
        hasExplicitSandboxPrototype(target) === explicit &&
        Reflect.ownKeys(current).length === descriptors.size &&
        Reflect.ownKeys(value).every((key) => unchanged(descriptors.get(key), Object.getOwnPropertyDescriptor(value, key)))
      );
    })
  );
  budget.setRetainedValues(root, () =>
    records.flatMap(({ target, value, descriptors, prototype: parent }) => [
      ...(getSandboxPrototype(target) === parent
        ? []
        : [getSandboxPrototype(target) as SandboxValue]),
      ...Reflect.ownKeys(value).flatMap(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        return unchanged(descriptors.get(key), descriptor)
          ? []
          : [key, descriptor.value, ...retainedAccessorClosures(descriptor)];
      })
    ])
  );
}

export function releaseObjectPrototype(budget: Budget): void {
  releaseTemplateObjects(budget);
  releaseIntrinsicIdentities(budget);
  for (const prototype of intrinsicPrototypeRoots.get(budget) ?? []) budget.setRetainedValues(prototype, undefined);
  intrinsicPrototypeRoots.delete(budget);
  boxedPrototypes.delete(budget);
  regexPrototypes.delete(budget);
  collectionPrototypes.delete(budget);
  initialRegexDescriptors.delete(budget);
  intrinsicPrototypes.delete(budget);
}

export function getSandboxPrototype(value: object, budget?: Budget): object | null {
  if (prototypes.has(value)) return prototypes.get(value) ?? null;
  if (budget !== undefined && (isSandboxMap(value) || isSandboxSet(value)))
    return collectionPrototypes.get(budget)?.get(isSandboxMap(value) ? "Map" : "Set") ?? null;
  if (budget !== undefined && isSandboxRegex(value)) return regexPrototypes.get(budget) ?? null;
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

export function hasNullObjectPrototype(value: object): boolean {
  return prototypes.get(value) === null && !Array.isArray(value) && !isSandboxClosure(value) && !isSandboxRegex(value);
}

export function getSandboxPropertyDescriptor(
  value: SandboxValue,
  key: PropertyKey,
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
    (Array.isArray(current) || isSandboxDate(current) || isSandboxRegex(current) || isSandboxMap(current) || isSandboxSet(current) || isPrototypeRecord(current))
  ) {
    const properties = isGuestClosure(current) ? getGuestFunctionProperties(current)
      : isSandboxRegex(current) ? getRegexProperties(current) : isSandboxMap(current) || isSandboxSet(current) ? getCollectionProperties(current) : current;
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
  key: PropertyKey,
  budget?: Budget
): SandboxValue {
  let current = value;
  let depth = 0;
  while (typeof current === "object" && current !== null) {
    if (isGuestHostObject(current)) return typeof key === "symbol" ? undefined : getHostObjectMember(current, String(key));
    if (isSandboxRegex(current)) return Object.getOwnPropertyDescriptor(getRegexProperties(current), key)?.value;
    if (isSandboxMap(current) || isSandboxSet(current)) return Object.getOwnPropertyDescriptor(getCollectionProperties(current), key)?.value;
    if (isGuestClosure(current)) {
      const entry = getGuestFunctionProperty(current, key);
      if (entry !== undefined || Object.hasOwn(current.properties ?? {}, key)) return entry;
    } else if (isSandboxClosure(current)) {
      const properties = current.properties;
      return properties !== undefined && Object.hasOwn(properties, key)
        ? properties[key]
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
    if (!isSandboxClosure(current) && Object.hasOwn(current, key)) return (current as SandboxObject)[key];
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
  if (
    (!Array.isArray(value) && !isSandboxRegex(value) && !isSandboxMap(value) && !isSandboxSet(value) && !isPrototypeRecord(value)) ||
    (prototype !== null && !Array.isArray(prototype) && !isSandboxMap(prototype) && !isSandboxSet(prototype) && !isPrototypeRecord(prototype))
  ) {
    throw new TypeError(
      "Prototype links require supported sandbox objects."
    );
  }
  if (getSandboxPrototype(value, budget) === prototype) {
    // Null is also the budget-free fallback; retain an explicit null link for snapshots.
    if (prototype === null) prototypes.set(value, null);
    return;
  }
  if (!Object.isExtensible(isGuestClosure(value) ? materializeFunctionProperties(value) : isSandboxRegex(value) ? getRegexProperties(value) : isSandboxMap(value) || isSandboxSet(value) ? getCollectionProperties(value) : value)) {
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
  if (functionProperties.has(value) || (prototypes.has(value) && !hasNullObjectPrototype(value))) return true;
  if (isSandboxBox(value) || isSandboxDate(value)) return false;
  return (
    descriptorObjects.has(value) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (descriptor) => !descriptor.enumerable || !descriptor.configurable || !descriptor.writable
    )
  );
}
