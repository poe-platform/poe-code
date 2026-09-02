import { readDataRecord, type HostOperation } from "../extensions.js";
import type { SandboxClosure, SandboxObject, SandboxValue } from "./values.js";
import type { SandboxIterator } from "./iteration.js";

declare const hostObjectBrand: unique symbol;
declare const guestReferenceBrand: unique symbol;
declare const sandboxHostObjectBrand: unique symbol;
type SandboxHostObject = SandboxObject & { readonly [sandboxHostObjectBrand]: true };
export type HostObject = Readonly<Record<string, never>> & { readonly [hostObjectBrand]: true };
export type GuestReference = Readonly<Record<string, never>> & {
  readonly [guestReferenceBrand]: true;
};
export type HostObjectIndexedDefinition = {
  length(): number;
  get(index: number): unknown;
  maxLength: number;
};
export type HostObjectDefinition = {
  indexed?: HostObjectIndexedDefinition;
  properties?: Record<string, { get?: () => unknown; set?: (value: unknown) => void }>;
  methods?: Record<string, HostOperation>;
};
export type HostObjectController = {
  owner: object;
  assertActive(): void;
  chargeWork(units?: number): void;
  checkLength(length: number): void;
  read(operation: () => unknown): SandboxValue;
  write(operation: (value: unknown) => void, value: SandboxValue): void;
  method(operation: HostOperation): SandboxClosure;
};
type HostObjectState = {
  controller: HostObjectController;
  host: HostObject;
  guest: SandboxObject;
  properties: Map<string, { get?: () => unknown; set?: (value: unknown) => void }>;
  methods: Map<string, SandboxClosure>;
  indexed?: HostObjectIndexedDefinition;
};
const MAX_INDEXED_LENGTH = 65_536;
type GuestCallbackState = { owner: object; closure?: SandboxClosure; assertActive(): void };
const hostObjects = new WeakMap<object, HostObjectState>();
const guestObjects = new WeakMap<object, HostObjectState>();
const guestCallbacks = new WeakMap<object, GuestCallbackState>();
const guestReferences = new WeakMap<
  object,
  { owner: object; root?: [SandboxValue]; assertActive(): void }
>();

export function createGuestReference(
  root: [SandboxValue],
  owner: object,
  assertActive: () => void
): GuestReference {
  const reference = Object.freeze(Object.create(null)) as GuestReference;
  guestReferences.set(reference, { root, owner, assertActive });
  return reference;
}

export function readGuestReference(reference: unknown, owner: object): SandboxValue {
  const state =
    typeof reference === "object" && reference !== null
      ? guestReferences.get(reference)
      : undefined;
  if (state === undefined || state.owner !== owner)
    throw new TypeError("Foreign or invalid guest reference.");
  state.assertActive();
  if (state.root === undefined) throw new TypeError("Guest reference is revoked.");
  return state.root[0];
}

export function revokeGuestReference(reference: GuestReference, owner: object): void {
  const state = guestReferences.get(reference);
  if (state === undefined || state.owner !== owner) throw new TypeError("Foreign guest reference.");
  state.root = undefined;
}

export function createLiveHostObject(
  definition: HostObjectDefinition,
  controller: HostObjectController
): HostObject {
  const input = readDataRecord(definition, "Host object definition");
  if (
    Object.keys(input).some((key) => key !== "properties" && key !== "methods" && key !== "indexed")
  )
    throw new TypeError("Unknown host object definition field.");
  let indexed: HostObjectIndexedDefinition | undefined;
  if (input.indexed !== undefined) {
    const data = readDataRecord(input.indexed, "Indexed host capability");
    if (Object.keys(data).some((key) => !["length", "get", "maxLength"].includes(key)))
      throw new TypeError("Unknown indexed host capability field.");
    if (typeof data.length !== "function" || typeof data.get !== "function")
      throw new TypeError("Indexed length and get must be synchronous functions.");
    if (
      typeof data.maxLength !== "number" ||
      !Number.isInteger(data.maxLength) ||
      data.maxLength < 1 ||
      data.maxLength > MAX_INDEXED_LENGTH
    )
      throw new RangeError(`Indexed maxLength must be an integer from 1 to ${MAX_INDEXED_LENGTH}.`);
    indexed = {
      length: data.length as () => number,
      get: data.get as (index: number) => unknown,
      maxLength: data.maxLength
    };
  }
  const properties = new Map<string, { get?: () => unknown; set?: (value: unknown) => void }>();
  for (const [name, inputProperty] of Object.entries(
    readDataRecord(input.properties ?? {}, "Host properties")
  )) {
    const property = readDataRecord(inputProperty, `Host property '${name}'`);
    if (Object.keys(property).some((key) => key !== "get" && key !== "set"))
      throw new TypeError("Unknown host property field.");
    if (
      (property.get !== undefined && typeof property.get !== "function") ||
      (property.set !== undefined && typeof property.set !== "function")
    )
      throw new TypeError("Host property operations must be functions.");
    properties.set(name, property as { get?: () => unknown; set?: (value: unknown) => void });
  }
  const operations = readDataRecord(input.methods ?? {}, "Host methods");
  for (const [name, operation] of Object.entries(operations)) {
    if (typeof operation !== "function") throw new TypeError("Host methods must be functions.");
    if (properties.has(name)) throw new TypeError(`Conflicting host member '${name}'.`);
  }
  for (const name of [...properties.keys(), ...Object.keys(operations)]) {
    if (["constructor", "prototype", "__proto__"].includes(name))
      throw new TypeError(`Reserved host member '${name}'.`);
    if (indexed !== undefined && (name === "length" || canonicalIndex(name) !== undefined))
      throw new TypeError(`Conflicting indexed host member '${name}'.`);
  }
  controller.assertActive();
  controller.chargeWork(properties.size + Object.keys(operations).length + 1);
  const host = Object.freeze(Object.create(null)) as HostObject;
  const guest = Object.freeze(Object.create(null)) as SandboxObject;
  const methods = new Map(
    Object.entries(operations).map(([name, operation]) => [
      name,
      controller.method(operation as HostOperation)
    ])
  );
  const state = { host, guest, controller, properties, methods, indexed };
  hostObjects.set(host, state);
  guestObjects.set(guest, state);
  return host;
}

export function isGuestHostObject(value: unknown): value is SandboxHostObject {
  return typeof value === "object" && value !== null && guestObjects.has(value);
}

export function isLiveCapability(value: unknown): boolean {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    (hostObjects.has(value) ||
      guestObjects.has(value) ||
      guestCallbacks.has(value) ||
      guestReferences.has(value))
  );
}

export function importHostCapability(value: object, owner: object): SandboxValue {
  if (guestReferences.has(value)) return readGuestReference(value, owner);
  const object = hostObjects.get(value);
  if (object !== undefined) {
    if (object.controller.owner !== owner) throw new TypeError("Foreign realm host capability.");
    object.controller.assertActive();
    return object.guest;
  }
  const callback = guestCallbacks.get(value);
  if (callback !== undefined) {
    if (callback.owner !== owner) throw new TypeError("Foreign realm guest callback.");
    callback.assertActive();
    if (callback.closure === undefined) throw new TypeError("Guest callback is revoked.");
    return callback.closure;
  }
  throw new TypeError("Unsupported live capability conversion.");
}

export function exportHostCapability(value: object, owner: object): HostObject {
  const state = guestObjects.get(value);
  if (state === undefined || state.controller.owner !== owner)
    throw new TypeError("Foreign realm host capability.");
  state.controller.assertActive();
  return state.host;
}

export function registerGuestCallback(callback: HostOperation, state: GuestCallbackState): void {
  guestCallbacks.set(callback, state);
}

export function readGuestCallback(callback: unknown, owner: object): SandboxClosure {
  const state = typeof callback === "function" ? guestCallbacks.get(callback) : undefined;
  if (state === undefined || state.owner !== owner)
    throw new TypeError("Foreign or invalid guest callback.");
  state.assertActive();
  if (state.closure === undefined) throw new TypeError("Guest callback is revoked.");
  return state.closure;
}

export function revokeGuestCallback(callback: object, owner: object): void {
  const state = guestCallbacks.get(callback);
  if (state === undefined || state.owner !== owner) throw new TypeError("Foreign guest callback.");
  state.closure = undefined;
}

export function revokeHostObject(value: HostObject, owner: object): void {
  const state = hostObjects.get(value);
  if (state === undefined || state.controller.owner !== owner)
    throw new TypeError("Foreign host object.");
  state.properties.clear();
  state.methods.clear();
  state.indexed = undefined;
}

export function getHostObjectMember(value: SandboxObject, key: string): SandboxValue {
  const state = guestObjects.get(value)!;
  state.controller.assertActive();
  state.controller.chargeWork();
  if (state.indexed !== undefined) {
    if (key === "length") return indexedLength(state);
    const index = canonicalIndex(key);
    if (index !== undefined) {
      if (index >= state.indexed.maxLength || index >= indexedLength(state)) return undefined;
      return state.controller.read(() => state.indexed!.get(index));
    }
  }
  const property = state.properties.get(key);
  if (property !== undefined)
    return property.get === undefined ? undefined : state.controller.read(property.get);
  return state.methods.get(key);
}

export function setHostObjectMember(value: SandboxObject, key: string, entry: SandboxValue): void {
  const state = guestObjects.get(value)!;
  state.controller.assertActive();
  state.controller.chargeWork();
  const property = state.properties.get(key);
  if (property?.set === undefined) throw new TypeError(`Host property '${key}' is not writable.`);
  state.controller.write(property.set, entry);
}

export function getHostObjectKeys(value: SandboxObject): string[] {
  const state = guestObjects.get(value)!;
  state.controller.assertActive();
  const length = state.indexed === undefined ? 0 : indexedLength(state);
  const size = length + state.properties.size + state.methods.size;
  state.controller.checkLength(size);
  state.controller.chargeWork(size + 1);
  return [
    ...Array.from({ length }, (_entry, index) => String(index)),
    ...state.properties.keys(),
    ...state.methods.keys()
  ];
}

export function hasHostObjectMember(
  value: SandboxObject,
  key: string,
  enumerableOnly = false
): boolean {
  const state = guestObjects.get(value)!;
  state.controller.assertActive();
  state.controller.chargeWork();
  if (state.indexed !== undefined) {
    if (key === "length") return !enumerableOnly;
    const index = canonicalIndex(key);
    if (index !== undefined) return index < state.indexed.maxLength && index < indexedLength(state);
  }
  return state.properties.has(key) || state.methods.has(key);
}

export function measureHostObjectData(value: SandboxObject): number {
  const state = guestObjects.get(value)!;
  let size = state.indexed === undefined ? 0 : 16;
  for (const key of state.properties.keys()) size += key.length + 1;
  for (const key of state.methods.keys()) size += key.length + 1;
  return size;
}

export function getHostObjectIterator(value: SandboxObject): SandboxIterator | undefined {
  const state = guestObjects.get(value)!;
  state.controller.assertActive();
  if (state.indexed === undefined) return undefined;
  let index = 0;
  let exhausted = false;
  return {
    next: () => {
      state.controller.assertActive();
      state.controller.chargeWork();
      if (exhausted) return { done: true, value: undefined };
      if (index >= indexedLength(state)) {
        exhausted = true;
        return { done: true, value: undefined };
      }
      const position = index++;
      return { done: false, value: state.controller.read(() => state.indexed!.get(position)) };
    }
  };
}

function indexedLength(state: HostObjectState): number {
  state.controller.chargeWork();
  const length = state.controller.read(state.indexed!.length);
  if (
    typeof length !== "number" ||
    !Number.isInteger(length) ||
    length < 0 ||
    length > state.indexed!.maxLength
  )
    throw new RangeError("Indexed length must be a non-negative integer within maxLength.");
  state.controller.checkLength(length);
  return length;
}

function canonicalIndex(key: string): number | undefined {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 0xffffffff && String(index) === key
    ? index
    : undefined;
}
