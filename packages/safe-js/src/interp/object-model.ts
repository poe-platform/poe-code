import { assertSandboxDataDepth } from "../graph-depth.js";
import { guestProxyStates } from "./guest-proxy.js";
import { getGeneratorProperties } from "./generator-properties.js";
import { asyncFunctionPrototypes } from "./generator-prototypes.js";
import { getClosureOrigin } from "./closure-origin.js";
import { runResources } from "./resources.js";
import { getIntrinsicIdentity, registerBuiltinIdentities, releaseIntrinsicIdentities } from "./intrinsics.js";
import { releaseTemplateObjects } from "./template-objects.js";
import { isSandboxDate } from "./date.js";
import { retainedAccessorClosures } from "./accessors.js";
import { internalSymbols } from "./internal-symbols.js";
import { intrinsicDataRoots } from "./intrinsic-data-roots.js";
import { getHostObjectMember, isGuestHostObject, isLiveCapability } from "./host-capabilities.js";
import type { Budget } from "./budget.js";
import { errorPrototypes } from "./error-prototypes.js";
import { typedArrayProperties, typedArrayStorage, isNumericTypedArray, isTypedArrayIndex } from "./typed-array.js";
import { typedArrayPrototypes } from "./typed-array-prototypes.js";
import { arrayBufferPrototypes, isSandboxArrayBuffer } from "./array-buffer.js";
import { dataViewPrototypes, isSandboxDataView } from "./data-view.js";
import { sandboxErrorTypes } from "../error/shape.js";
import { boxedValue, isSandboxBox, type BoxedKind, type BoxedPrimitive } from "./boxed.js";
import {
  isSandboxClosure,
  isSandboxGenerator,
  isSandboxMap,
  isSandboxPromise,
  getPromiseProperties,
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
export const hostFunctionPropertyTables = new WeakSet<object>();
const functionPropertyRevisions = new WeakMap<object, {
  revision: number;
  measuredRevision?: number;
  measuredDescriptors?: Array<[string, PropertyDescriptor]>;
}>();
const trackedIntrinsicObjects = new WeakSet<object>();
const prototypes = new WeakMap<object, object | null>();
const defaultPrototypeLinks = new WeakMap<object, object>();
const intrinsicPrototypeOwners = new WeakMap<object, SandboxClosure>();
const trackedPrototypes = new WeakMap<object, { current: object | null }>();

function storePrototype(value: object, prototype: object | null): void {
  prototypes.set(value, prototype);
  const tracked = trackedPrototypes.get(value);
  if (tracked !== undefined) tracked.current = prototype;
}
const intrinsicPrototypes = new WeakMap<Budget, SandboxObject>();
const boxedPrototypes = new WeakMap<Budget, Map<BoxedKind, SandboxObject>>();
const regexPrototypes = new WeakMap<Budget, SandboxObject>();
const collectionPrototypes = new WeakMap<Budget, Map<"Map" | "Set", SandboxObject>>();
const promisePrototypes = new WeakMap<Budget, SandboxObject>();
const datePrototypes = new WeakMap<Budget, SandboxObject>();
const arrayPrototypes = new WeakMap<Budget, SandboxValue[]>();
const functionPrototypes = new WeakMap<Budget, SandboxClosure>();
const initialArrayMethods = new WeakMap<object, Map<string, SandboxValue>>();
const initialRegexDescriptors = new WeakMap<Budget, PropertyDescriptorMap>();
const intrinsicPrototypeRoots = new WeakMap<Budget, Set<object>>();
const intrinsicRetentionTargets = new WeakMap<Budget, WeakSet<object>>();
const intrinsicRetentionGroups = new WeakMap<Budget, Map<object, ReturnType<typeof captureIntrinsicRecords>>>();
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

export function intrinsicFunctionDataDescriptors(properties: SandboxObject): Array<[string, PropertyDescriptor]> {
  const state = functionPropertyRevisions.get(properties);
  if (state?.measuredDescriptors !== undefined && state.measuredRevision === state.revision)
    return state.measuredDescriptors;
  const descriptors = Object.entries(Object.getOwnPropertyDescriptors(properties))
    .filter(([key]) => key !== "prototype" && key !== "name" && key !== "length");
  if (state !== undefined) {
    state.measuredRevision = state.revision;
    state.measuredDescriptors = descriptors;
  }
  return descriptors;
}

export function materializeFunctionProperties(closure: SandboxClosure, initialProperties?: SandboxObject): SandboxObject {
  const existing = functionProperties.get(closure);
  if (existing !== undefined) return existing;
  if (initialProperties !== undefined) {
    // Restored graph roots may already alias this exact property table.
    descriptorObjects.add(initialProperties);
    if (!isGuestClosure(closure)) hostFunctionPropertyTables.add(initialProperties);
    functionProperties.set(closure, initialProperties);
    return initialProperties;
  }
  const properties = Object.create(null) as SandboxObject;
  Object.defineProperties(properties, {
    length: { value: closure.length ?? 0, configurable: true },
    name: { value: closure.name ?? "", configurable: true }
  });
  if (isGuestClosure(closure) && closure.construct !== undefined && closure.boundTarget === undefined) {
    const prototype = Object.create(null) as SandboxObject;
    Object.defineProperty(prototype, "constructor", {
      value: closure,
      writable: true,
      configurable: true
    });
    descriptorObjects.add(prototype);
    Object.defineProperty(properties, "prototype", { value: prototype, writable: true });
  }
  const tracked = trackPropertyTable(properties);
  descriptorObjects.add(tracked);
  if (!isGuestClosure(closure)) hostFunctionPropertyTables.add(tracked);
  functionProperties.set(closure, tracked);
  return tracked;
}

export function createIntrinsicObject(initial: SandboxObject = Object.create(null)): SandboxObject {
  // Copy first so no caller retains an untracked alias to the backing table.
  const tracked = trackPropertyTable(Object.create(Object.getPrototypeOf(initial), Object.getOwnPropertyDescriptors(initial)));
  trackedIntrinsicObjects.add(tracked);
  return tracked;
}

export function isTrackedIntrinsicObject(value: object): boolean {
  return trackedIntrinsicObjects.has(value);
}

function trackPropertyTable(properties: SandboxObject): SandboxObject {
  // Never expose the raw table: native callers must invalidate captures too.
  const state = { revision: 0 };
  const tracked = new Proxy(properties, {
    defineProperty(target, key, descriptor) {
      const changed = Reflect.defineProperty(target, key, descriptor);
      if (changed) state.revision++;
      return changed;
    },
    deleteProperty(target, key) {
      const changed = Reflect.deleteProperty(target, key);
      if (changed) state.revision++;
      return changed;
    }
  });
  functionPropertyRevisions.set(tracked, state);
  return tracked;
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
  storePrototype(prototype, null);
  intrinsicPrototypes.set(budget, prototype);
  registerIntrinsicPrototype(budget, prototype, constructor);
}

export function installFunctionPrototype(budget: Budget, prototype: SandboxClosure): void {
  functionPrototypes.set(budget, prototype);
  registerBuiltinIdentities(budget, { "%FunctionPrototype%": prototype });
  registerIntrinsicFunction(budget, prototype);
  registerIntrinsicObject(budget, materializeFunctionProperties(prototype));
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

export function installPromisePrototype(budget: Budget, prototype: SandboxObject, constructor: SandboxClosure): void {
  promisePrototypes.set(budget, prototype);
  registerIntrinsicPrototype(budget, prototype, constructor);
}

export function installDatePrototype(budget: Budget, prototype: SandboxObject, constructor: SandboxClosure): void {
  datePrototypes.set(budget, prototype);
  registerIntrinsicPrototype(budget, prototype, constructor);
}

export function installArrayPrototype(budget: Budget, prototype: SandboxValue[], constructor: SandboxClosure): void {
  arrayPrototypes.set(budget, prototype);
  storePrototype(prototype, intrinsicPrototypes.get(budget) ?? null);
  initialArrayMethods.set(prototype, new Map(Object.entries(Object.getOwnPropertyDescriptors(prototype)).map(([key, descriptor]) => [key, descriptor.value])));
  registerIntrinsicPrototype(budget, prototype as unknown as SandboxObject, constructor);
}

export function isDefaultArrayMethod(value: SandboxValue[], key: string, budget: Budget): boolean {
  const prototype = arrayPrototypes.get(budget);
  return prototype !== undefined && getSandboxPrototype(value, budget) === prototype &&
    !Object.hasOwn(value, key) && initialArrayMethods.get(prototype)?.has(key) === true &&
    Object.getOwnPropertyDescriptor(prototype, key)?.value === initialArrayMethods.get(prototype)?.get(key);
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
  intrinsicPrototypeOwners.set(prototype, constructor);
}

export function registerIntrinsicFunction(budget: Budget, closure: SandboxClosure): void {
  if (closure.name === undefined) throw new TypeError("Intrinsic functions require an installation name.");
  if (getIntrinsicIdentity(closure) === undefined)
    registerBuiltinIdentities(budget, { [closure.name]: closure });
  trackIntrinsicState(budget, closure, closure, [closure]);
}

export function registerIntrinsicObject(budget: Budget, value: SandboxObject, trackMethods = true): void {
  const methods = trackMethods ? Object.values(Object.getOwnPropertyDescriptors(value))
    .map(descriptor => descriptor.value).filter(isGuestClosure) : [];
  trackIntrinsicState(budget, value, value, [value, ...methods]);
}

// Only builtin installation may replace a partially initialized baseline.
// Ordinary repeated registration must keep charging earlier guest mutations.
export function completeIntrinsicObjectInitialization(budget: Budget, value: SandboxObject | SandboxClosure): void {
  for (const records of intrinsicRetentionGroups.get(budget)?.values() ?? []) {
    const record = records.find(record => record.target === value);
    if (record === undefined) continue;
    Object.assign(record, captureIntrinsicRecords([value])[0]);
    return;
  }
}

function captureIntrinsicRecords(targets: Array<SandboxObject | SandboxClosure>) {
  return [...new Set(targets)]
    .map((target) => {
      let tracked = trackedPrototypes.get(target);
      if (tracked === undefined) {
        tracked = { current: getSandboxPrototype(target) };
        trackedPrototypes.set(target, tracked);
      }
      return {
        target,
        value: isGuestClosure(target) ? materializeFunctionProperties(target) : target,
        prototype: tracked.current,
        tracked,
        explicit: hasExplicitSandboxPrototype(target)
      };
    })
    .map((record) => ({
      ...record,
      dataRoot: {},
      revision: functionPropertyRevisions.get(record.value),
      capturedRevision: -1,
      captured: undefined as unknown[] | undefined,
      extensible: Object.isExtensible(record.value),
      descriptors: new Map(Reflect.ownKeys(record.value).map(key => [key, Object.getOwnPropertyDescriptor(record.value, key)!]))
    }));
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
  const records = captureIntrinsicRecords(targets);
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
  let retainedTargets = intrinsicRetentionTargets.get(budget);
  if (retainedTargets === undefined) intrinsicRetentionTargets.set(budget, retainedTargets = new WeakSet());
  let groups = intrinsicRetentionGroups.get(budget);
  if (groups === undefined) intrinsicRetentionGroups.set(budget, groups = new Map());
  let retainedRecords = groups.get(root);
  if (retainedRecords === undefined) groups.set(root, retainedRecords = []);
  for (const record of records) {
    if (retainedTargets.has(record.target)) continue;
    retainedTargets.add(record.target);
    retainedRecords.push(record);
  }
  if (retainedRecords.length === 0) return;
  budget.setRetainedValues(root, () => {
    // Capture every change before measurement invokes retained-value callbacks.
    let retained: unknown[] | undefined;
    for (const record of retainedRecords) {
      let contributions: unknown[] | undefined;
      const { value, descriptors, prototype: parent, revision } = record;
      const currentPrototype = record.tracked.current;
      if (currentPrototype !== parent) (contributions ??= []).push(currentPrototype);
      if (revision === undefined || revision.revision !== record.capturedRevision) {
        let captured: unknown[] | undefined;
        for (const key of Reflect.ownKeys(value)) {
          const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
          if (unchanged(descriptors.get(key), descriptor)) continue;
          (captured ??= []).push(key, descriptor.value, ...retainedAccessorClosures(descriptor));
        }
        record.captured = captured;
        record.capturedRevision = revision?.revision ?? -1;
      }
      if (record.captured !== undefined) {
        for (const item of record.captured) (contributions ??= []).push(item);
      }
      if (contributions !== undefined) {
        // Box measurement traverses every mutable property. Other intrinsic
        // kinds may omit baseline fields, so their projections stay explicit.
        if (isSandboxBox(record.target)) {
          intrinsicDataRoots.set(record.dataRoot, { target: record.target, values: contributions });
          (retained ??= []).push(record.dataRoot);
        } else {
          for (const item of contributions) (retained ??= []).push(item);
        }
      } else {
        intrinsicDataRoots.delete(record.dataRoot);
      }
    }
    return retained;
  });
}

export function releaseObjectPrototype(budget: Budget): void {
  releaseTemplateObjects(budget);
  releaseIntrinsicIdentities(budget);
  for (const prototype of intrinsicPrototypeRoots.get(budget) ?? []) budget.setRetainedValues(prototype, undefined);
  intrinsicPrototypeRoots.delete(budget);
  intrinsicRetentionTargets.delete(budget);
  intrinsicRetentionGroups.delete(budget);
  collectionPrototypes.delete(budget);
  promisePrototypes.delete(budget);
  // Keep object, array, boxed, Date, RegExp, Error and generator lookups for live SDK closures
  // that create values in this realm. Weak budget keys bound their lifetimes;
  // accounting roots above are still released.
  functionPrototypes.delete(budget);
  typedArrayPrototypes.delete(budget);
  arrayBufferPrototypes.delete(budget);
  initialRegexDescriptors.delete(budget);
}

export function getSandboxPrototype(value: object, budget?: Budget): object | null {
  const explicit = prototypes.get(value);
  if (explicit !== undefined) return explicit;
  if (budget === undefined) return null;
  if (isSandboxArrayBuffer(value)) return budget === undefined ? null : arrayBufferPrototypes.get(budget) ?? null;
  if (isSandboxDataView(value)) return dataViewPrototypes.get(budget) ?? null;
  if (isNumericTypedArray(value)) return budget === undefined ? null : typedArrayPrototypes.get(budget)?.get(typedArrayStorage(value).Native) ?? null;
  // Host transport records are data-only. Resolve their default prototype in
  // the receiving realm without persisting executable intrinsic graphs.
  const errorType = sandboxErrorTypes.get(value);
  if (budget !== undefined && errorType !== undefined) {
    const prototype = errorPrototypes.get(budget)?.get(errorType);
    if (prototype !== undefined) return prototype;
  }
  if (budget !== undefined && isSandboxClosure(value) && runResources.getStore()?.functionSourceText !== false) {
    const node = getClosureOrigin(value)?.node;
    if (node?.async && (node.type === "ArrowFunctionExpression" || !node.generator))
      return asyncFunctionPrototypes.get(budget) ?? functionPrototypes.get(budget) ?? null;
    return functionPrototypes.get(budget) ?? null;
  }
  if (budget !== undefined && Array.isArray(value)) return arrayPrototypes.get(budget) ?? null;
  if (budget !== undefined && isSandboxDate(value)) return datePrototypes.get(budget) ?? null;
  if (budget !== undefined && isSandboxPromise(value)) return promisePrototypes.get(budget) ?? null;
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
  budget?: Budget,
  onProxy?: (proxy: object) => void
): PropertyDescriptor | undefined {
  let current = value;
  let depth = 0;
  while (
    typeof current === "object" &&
    current !== null &&
    (Array.isArray(current) || isSandboxGenerator(current) || isSandboxDate(current) || isSandboxPromise(current) || isSandboxRegex(current) || isSandboxMap(current) || isSandboxSet(current) || isPrototypeRecord(current))
  ) {
    // Callers with asynchronous property dispatch must resume at the exotic
    // boundary rather than inspect the Proxy carrier or skip its traps.
    if (onProxy !== undefined && guestProxyStates.has(current)) {
      onProxy(current);
      return undefined;
    }
    // An integer-indexed object stops numeric-key lookup even when it occurs
    // inside another object's prototype chain and the index is invalid.
    if (isNumericTypedArray(current) && typeof key !== "symbol" && isTypedArrayIndex(String(key)))
      return Object.getOwnPropertyDescriptor(current, key);
    const properties = isSandboxGenerator(current) ? getGeneratorProperties(current) : isSandboxPromise(current) ? getPromiseProperties(current) : isSandboxClosure(current)
      ? key === "prototype" && current.construct !== undefined && current.boundTarget === undefined
        ? materializeFunctionProperties(current) : getGuestFunctionProperties(current)
      : isSandboxRegex(current) ? getRegexProperties(current) : isSandboxMap(current) || isSandboxSet(current) ? getCollectionProperties(current) : current;
    if (properties === undefined && isSandboxClosure(current) && (key === "name" || key === "length"))
      return { value: key === "name" ? current.name ?? "" : current.length ?? 0,
        writable: false, enumerable: false, configurable: true };
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
    if (isNumericTypedArray(current) && typeof key !== "symbol" && isTypedArrayIndex(String(key)))
      return Object.getOwnPropertyDescriptor(current, key)?.value;
    if (isGuestHostObject(current)) return typeof key === "symbol" ? undefined : getHostObjectMember(current, String(key));
    if (isSandboxRegex(current)) return Object.getOwnPropertyDescriptor(getRegexProperties(current), key)?.value;
    if (isSandboxPromise(current)) return Object.getOwnPropertyDescriptor(getPromiseProperties(current), key)?.value;
    if (isSandboxGenerator(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(getGeneratorProperties(current), key);
      if (descriptor !== undefined) return descriptor.value;
    }
    if (isSandboxMap(current) || isSandboxSet(current)) return Object.getOwnPropertyDescriptor(getCollectionProperties(current), key)?.value;
    if (isSandboxClosure(current)) {
      const entry = getGuestFunctionProperty(current, key);
      if (entry !== undefined || Object.hasOwn(current.properties ?? {}, key)) return entry;
    }
    if (
      isSandboxMap(current) ||
      isSandboxSet(current) ||
      isSandboxPromise(current) ||
      isSandboxRegex(current)
    )
      return undefined;
    if (!isSandboxClosure(current) && !isSandboxGenerator(current) && Object.hasOwn(current, key)) return (current as SandboxObject)[key];
    current = getSandboxPrototype(current, budget) as SandboxValue;
    if (current !== null) {
      budget?.visitNode();
      assertSandboxDataDepth(++depth);
    }
  }
  return undefined;
}

export function createOrdinaryObject(prototype: object | null, properties: SandboxObject = {}): SandboxObject {
  const value = { ...properties };
  storePrototype(value, prototype);
  if (prototype !== null) defaultPrototypeLinks.set(value, prototype);
  return value;
}

export function setSandboxPrototype(
  value: object,
  prototype: object | null,
  budget?: Budget,
  throwOnFailure = true
): boolean {
  if (budget !== undefined && intrinsicPrototypes.get(budget) === value && prototype !== null) {
    if (!throwOnFailure) return false;
    throw new TypeError("Object.prototype has an immutable null prototype.");
  }
  if (
    (!Array.isArray(value) && !isSandboxGenerator(value) && !isSandboxDate(value) && !isSandboxPromise(value) && !isSandboxRegex(value) && !isSandboxMap(value) && !isSandboxSet(value) && !isPrototypeRecord(value)) ||
    (prototype !== null && !Array.isArray(prototype) && !isSandboxGenerator(prototype) && !isSandboxDate(prototype) && !isSandboxPromise(prototype) && !isSandboxRegex(prototype) && !isSandboxMap(prototype) && !isSandboxSet(prototype) && !isPrototypeRecord(prototype))
  ) {
    throw new TypeError(
      "Prototype links require supported sandbox objects."
    );
  }
  if (getSandboxPrototype(value, budget) === prototype) {
    // Preserve the requested link beyond the lifetime of the realm fallback.
    if (prototype !== null && !prototypes.has(value)) defaultPrototypeLinks.set(value, prototype);
    storePrototype(value, prototype);
    return true;
  }
  if (!Object.isExtensible(isSandboxGenerator(value) ? getGeneratorProperties(value) : isSandboxClosure(value) ? materializeFunctionProperties(value) : isSandboxPromise(value) ? getPromiseProperties(value) : isSandboxRegex(value) ? getRegexProperties(value) : isSandboxMap(value) || isSandboxSet(value) ? getCollectionProperties(value) : value)) {
    if (!throwOnFailure) return false;
    throw new TypeError("Cannot change the prototype of a non-extensible object.");
  }
  let depth = 0;
  for (let current = prototype; current !== null; current = getSandboxPrototype(current, budget)) {
    budget?.visitNode();
    assertSandboxDataDepth(depth++);
    if (current === value) {
      if (!throwOnFailure) return false;
      throw new TypeError("Cyclic prototype value.");
    }
  }
  storePrototype(value, prototype);
  return true;
}

function isPrototypeRecord(value: object): boolean {
  if (isSandboxDataView(value)) return true;
  if (isSandboxArrayBuffer(value)) return true;
  if (isNumericTypedArray(value)) return true;
  if (isSandboxClosure(value)) return true;
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
  if (functionProperties.has(value)) return true;
  if (prototypes.has(value) && !hasNullObjectPrototype(value)) {
    const prototype = prototypes.get(value);
    if (prototype === undefined || prototype === null || prototype !== defaultPrototypeLinks.get(value)) return true;
    // Data transport may omit only a pristine originating default chain. A
    // changed prototype or intrinsic method still requires guest graph state.
    for (let current: object | null = prototype; current !== null; current = getSandboxPrototype(current)) {
      const owner = intrinsicPrototypeOwners.get(current) ?? current;
      if (intrinsicConstructors.get(owner)?.() !== true) return true;
    }
  }
  if (isSandboxBox(value) || isSandboxDate(value)) return false;
  if (Array.isArray(value) && descriptorObjects.has(value)) {
    return Object.getOwnPropertyNames(value).some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value,key)!;
      // Every array has a non-enumerable, non-configurable length. Only its
      // writable flag can make that intrinsic descriptor non-default.
      return key === "length" ? descriptor.writable !== true
        : !descriptor.enumerable || !descriptor.configurable || !descriptor.writable;
    });
  }
  return (
    descriptorObjects.has(value) &&
    (isNumericTypedArray(value)
      ? typedArrayProperties(value).map(([, descriptor]) => descriptor)
      : Reflect.ownKeys(value)
        .filter(key => typeof key !== "symbol" || !internalSymbols.has(key))
        .map(key => Object.getOwnPropertyDescriptor(value, key)!)).some(
      (descriptor) => !descriptor.enumerable || !descriptor.configurable || !descriptor.writable
    )
  );
}
