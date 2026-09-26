import { readDataRecord, type HostOperation } from "../extensions.js";
import { types } from "#safe-js-platform";
import { createIntrinsicObject } from "./object-model.js";
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
  expandos?: { maxKeys: number; maxKeyCodeUnits: number; assertActive?: () => void };
  indexed?: HostObjectIndexedDefinition;
  named?: HostObjectNamedDefinition;
  properties?: Record<string, { get?: () => unknown; set?: (value: unknown) => void }>;
  methods?: Record<string, HostOperation>;
};
export type HostObjectNamedDefinition = {
  keys(): readonly string[];
  get(name: string): unknown;
  set?(name: string, value: unknown): void;
  delete?(name: string): boolean;
  maxKeys: number;
  maxKeyCodeUnits: number;
  enumerable?: boolean;
};
export type HostObjectController = {
  owner: object;
  assertActive(): void;
  chargeWork(units?: number): void;
  chargeGuestData(units: number): void;
  checkLength(length: number): void;
  checkString(value: string): void;
  checkTemporaryDataSize(size: number): void;
  read(operation: () => unknown, validate?: (value: unknown) => unknown): SandboxValue;
  write(operation: (value: unknown) => void, value: SandboxValue): void;
  method(operation: HostOperation): SandboxClosure;
};
type HostObjectState = {
  controller: HostObjectController;
  memberDataUnits: number;
  host: HostObject;
  guest: SandboxObject;
  properties: Map<string, { get?: () => unknown; set?: (value: unknown) => void }>;
  methods: Map<string, SandboxClosure>;
  indexed?: HostObjectIndexedDefinition;
  named?: HostObjectNamedDefinition;
  expandos?: { values: SandboxObject; maxKeys: number; maxKeyCodeUnits: number; assertActive?: () => void };
};
const MAX_INDEXED_LENGTH = 65_536;
const MAX_NAMED_KEYS = 65_536;
const MAX_NAMED_KEY_CODE_UNITS = 1_048_576;
type GuestCallbackState = { owner: object; closure?: SandboxClosure; assertActive(): void };
const hostObjects = new WeakMap<object, HostObjectState>();
const guestObjects = new WeakMap<object, HostObjectState>();
const readHostObject = WeakMap.prototype.get.bind(hostObjects) as (
  value: object
) => HostObjectState | undefined;
const writeHostObject = WeakMap.prototype.set.bind(hostObjects) as (
  value: object,
  state: HostObjectState
) => unknown;
const hasHostObject = WeakMap.prototype.has.bind(hostObjects) as (value: object) => boolean;
const readGuestObject = WeakMap.prototype.get.bind(guestObjects) as (
  value: object
) => HostObjectState | undefined;
const writeGuestObject = WeakMap.prototype.set.bind(guestObjects) as (
  value: object,
  state: HostObjectState
) => unknown;
const hasGuestObject = WeakMap.prototype.has.bind(guestObjects) as (value: object) => boolean;
const MemberMap = Map;
const nativeMemberMap = {
  get: Function.prototype.call.bind(Map.prototype.get) as <K, V>(
    map: Map<K, V>,
    key: K
  ) => V | undefined,
  set: Function.prototype.call.bind(Map.prototype.set) as <K, V>(
    map: Map<K, V>,
    key: K,
    value: V
  ) => Map<K, V>,
  has: Function.prototype.call.bind(Map.prototype.has) as <K, V>(map: Map<K, V>, key: K) => boolean,
  keys: Function.prototype.call.bind(Map.prototype.keys) as <K, V>(
    map: Map<K, V>
  ) => MapIterator<K>,
  clear: Function.prototype.call.bind(Map.prototype.clear) as <K, V>(map: Map<K, V>) => void,
  size: Function.prototype.call.bind(
    Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!
  ) as <K, V>(map: Map<K, V>) => number,
  next: Function.prototype.call.bind(Object.getPrototypeOf(new Map().keys()).next) as <K>(
    iterator: MapIterator<K>
  ) => IteratorResult<K>
};

function memberNameUnits(map: Map<string, unknown>): number {
  const keys = nativeMemberMap.keys(map);
  let units = 0;
  for (let key = nativeMemberMap.next(keys); !key.done; key = nativeMemberMap.next(keys))
    units += key.value.length + 1;
  return units;
}

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
    Object.keys(input).some((key) => !["properties", "methods", "indexed", "named", "expandos"].includes(key))
  )
    throw new TypeError("Unknown host object definition field.");
  let expandos: HostObjectState["expandos"];
  if (input.expandos !== undefined) {
    const data = readDataRecord(input.expandos, "Guest expando definition");
    if (Object.keys(data).some((key) => !["maxKeys", "maxKeyCodeUnits", "assertActive"].includes(key)))
      throw new TypeError("Unknown guest expando field.");
    for (const [key, maximum] of [["maxKeys", MAX_NAMED_KEYS], ["maxKeyCodeUnits", MAX_NAMED_KEY_CODE_UNITS]] as const) {
      if (typeof data[key] !== "number" || !Number.isInteger(data[key]) || data[key] < 1 || data[key] > maximum)
        throw new RangeError(`Guest expando ${key} must be an integer from 1 to ${maximum}.`);
    }
    if (data.assertActive !== undefined && (
      typeof data.assertActive !== "function" || types.isProxy(data.assertActive) ||
      types.isAsyncFunction(data.assertActive) || types.isGeneratorFunction(data.assertActive)
    ))
      throw new TypeError("Guest expando assertActive must be a synchronous function, not a proxy.");
    expandos = {
      // Owned writes invalidate descriptor projections; descendants stay live.
      values: createIntrinsicObject(),
      maxKeys: data.maxKeys as number,
      maxKeyCodeUnits: data.maxKeyCodeUnits as number,
      assertActive: data.assertActive as (() => void) | undefined
    };
  }
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
  let named: HostObjectNamedDefinition | undefined;
  if (input.named !== undefined) {
    const data = readDataRecord(input.named, "Named host capability");
    if (
      Object.keys(data).some(
        (key) => !["keys", "get", "set", "delete", "maxKeys", "maxKeyCodeUnits", "enumerable"].includes(key)
      )
    )
      throw new TypeError("Unknown named host capability field.");
    for (const name of ["keys", "get", "set", "delete"]) {
      const operation = data[name];
      if (operation === undefined && (name === "set" || name === "delete")) continue;
      if (
        typeof operation !== "function" || types.isProxy(operation) ||
        types.isAsyncFunction(operation) || types.isGeneratorFunction(operation)
      )
        throw new TypeError(`Named ${name} must be a synchronous non-generator function, not a proxy.`);
    }
    if (
      typeof data.maxKeys !== "number" ||
      !Number.isInteger(data.maxKeys) ||
      data.maxKeys < 1 ||
      data.maxKeys > MAX_NAMED_KEYS
    )
      throw new RangeError(`Named maxKeys must be an integer from 1 to ${MAX_NAMED_KEYS}.`);
    if (
      typeof data.maxKeyCodeUnits !== "number" ||
      !Number.isInteger(data.maxKeyCodeUnits) ||
      data.maxKeyCodeUnits < 1 ||
      data.maxKeyCodeUnits > MAX_NAMED_KEY_CODE_UNITS
    )
      throw new RangeError(
        `Named maxKeyCodeUnits must be an integer from 1 to ${MAX_NAMED_KEY_CODE_UNITS}.`
      );
    if (data.enumerable !== undefined && typeof data.enumerable !== "boolean")
      throw new TypeError("Named enumerable must be a boolean.");
    named = {
      keys: data.keys as () => readonly string[],
      get: data.get as (name: string) => unknown,
      set: data.set as HostObjectNamedDefinition["set"],
      delete: data.delete as HostObjectNamedDefinition["delete"],
      maxKeys: data.maxKeys,
      maxKeyCodeUnits: data.maxKeyCodeUnits,
      enumerable: data.enumerable as boolean | undefined
    };
  }
  if (expandos !== undefined && named !== undefined)
    throw new TypeError("Guest expandos cannot be combined with named host properties.");
  const properties = new MemberMap<
    string,
    { get?: () => unknown; set?: (value: unknown) => void }
  >();
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
    // Retain fixed slots instead of the validator's dictionary-backed record.
    // Both slots are own fields, including absent operations.
    nativeMemberMap.set(properties, name, {
      get: property.get as (() => unknown) | undefined,
      set: property.set as ((value: unknown) => void) | undefined
    });
  }
  const operations = readDataRecord(input.methods ?? {}, "Host methods");
  for (const [name, operation] of Object.entries(operations)) {
    if (typeof operation !== "function") throw new TypeError("Host methods must be functions.");
    if (nativeMemberMap.has(properties, name))
      throw new TypeError(`Conflicting host member '${name}'.`);
  }
  for (const name of [...nativeMemberMap.keys(properties), ...Object.keys(operations)]) {
    if (["constructor", "prototype", "__proto__"].includes(name))
      throw new TypeError(`Reserved host member '${name}'.`);
    if (indexed !== undefined && (name === "length" || canonicalIndex(name) !== undefined))
      throw new TypeError(`Conflicting indexed host member '${name}'.`);
  }
  controller.assertActive();
  controller.chargeWork(nativeMemberMap.size(properties) + Object.keys(operations).length + 1);
  const host = Object.freeze(Object.create(null)) as HostObject;
  const guest = Object.freeze(Object.create(null)) as SandboxObject;
  const methods = new MemberMap<string, SandboxClosure>();
  for (const [name, operation] of Object.entries(operations))
    nativeMemberMap.set(methods, name, controller.method(operation as HostOperation));
  // Private member maps do not change until owned revocation.
  const memberDataUnits =
    (indexed === undefined ? 0 : 16) +
    (named === undefined ? 0 : 24) +
    memberNameUnits(properties) +
    memberNameUnits(methods);
  const state = {
    host,
    guest,
    controller,
    properties,
    methods,
    indexed,
    named,
    expandos,
    memberDataUnits
  };
  writeHostObject(host, state);
  writeGuestObject(guest, state);
  return host;
}

export function isGuestHostObject(value: unknown): value is SandboxHostObject {
  return typeof value === "object" && value !== null && hasGuestObject(value);
}

export function isLiveCapability(value: unknown): boolean {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    (hasHostObject(value) ||
      hasGuestObject(value) ||
      guestCallbacks.has(value) ||
      guestReferences.has(value))
  );
}

export function importHostCapability(value: object, owner: object): SandboxValue {
  if (guestReferences.has(value)) return readGuestReference(value, owner);
  const object = readHostObject(value);
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
  const state = readGuestObject(value);
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
  const state = readHostObject(value);
  if (state === undefined || state.controller.owner !== owner)
    throw new TypeError("Foreign host object.");
  nativeMemberMap.clear(state.properties);
  nativeMemberMap.clear(state.methods);
  state.indexed = undefined;
  state.named = undefined;
  state.expandos = undefined;
  state.memberDataUnits = 0;
}

export function getHostObjectMember(value: SandboxObject, key: string | symbol): SandboxValue {
  const state = readGuestObject(value)!;
  state.controller.assertActive();
  state.controller.chargeWork();
  assertExpandoActive(state);
  if (state.expandos && Object.hasOwn(state.expandos.values, key))
    return Reflect.get(state.expandos.values, key);
  if (typeof key === "symbol") return undefined;
  if (state.indexed !== undefined) {
    if (key === "length") return indexedLength(state);
    const index = canonicalIndex(key);
    if (index !== undefined) {
      if (index >= state.indexed.maxLength || index >= indexedLength(state)) return undefined;
      return state.controller.read(() => state.indexed!.get(index));
    }
  }
  const property = nativeMemberMap.get(state.properties, key);
  if (property !== undefined)
    return property.get === undefined ? undefined : state.controller.read(property.get);
  const method = nativeMemberMap.get(state.methods, key);
  if (method !== undefined) return method;
  if (state.named !== undefined && namedKeys(state).includes(key))
    return state.controller.read(() => state.named!.get(key));
  return undefined;
}

export function setHostObjectMember(value: SandboxObject, key: string | symbol, entry: SandboxValue): void {
  const state = readGuestObject(value)!;
  state.controller.assertActive();
  state.controller.chargeWork();
  assertExpandoActive(state);
  const property = typeof key === "string" ? nativeMemberMap.get(state.properties, key) : undefined;
  if (property !== undefined) {
    if (property.set === undefined) throw new TypeError(`Host property '${String(key)}' is not writable.`);
    state.controller.write(property.set, entry);
    return;
  }
  if (state.expandos !== undefined) {
    validateExpandoKey(state, key);
    const current = Object.getOwnPropertyDescriptor(state.expandos.values, key);
    if (current && !current.writable) throw new TypeError("Guest expando is not writable.");
    if (!current) state.controller.chargeGuestData(expandoKeyUnits(key) + 1);
    Object.defineProperty(state.expandos.values, key, current ? { value: entry } : {
      value: entry, writable: true, enumerable: true, configurable: true
    });
    return;
  }
  if (typeof key === "symbol") throw new TypeError("Host properties require string keys.");
  if (state.named?.set === undefined) throw new TypeError(`Host property '${String(key)}' is not writable.`);
  namedMutationKeys(state, key, true);
  state.controller.write((value) => state.named!.set!(key, value), entry);
  namedKeys(state);
}

export function deleteHostObjectMember(value: SandboxObject, key: string | symbol): boolean {
  const state = readGuestObject(value)!;
  state.controller.assertActive();
  state.controller.chargeWork();
  assertExpandoActive(state);
  if (state.expandos !== undefined) {
    validateExpandoKey(state, key, false);
    return Reflect.deleteProperty(state.expandos.values, key);
  }
  if (typeof key === "symbol") throw new TypeError("Host properties require string keys.");
  if (state.named?.delete === undefined) throw new TypeError("Live host properties cannot be deleted.");
  if (!namedMutationKeys(state, key, false).includes(key)) return true;
  const deleted = state.controller.read(() => state.named!.delete!(key), (result) => {
    if (typeof result !== "boolean") throw new TypeError("Named delete must return a boolean.");
    return result;
  });
  namedKeys(state);
  return deleted as boolean;
}

export function getHostObjectKeys(value: SandboxObject): string[] {
  const state = readGuestObject(value)!;
  state.controller.assertActive();
  assertExpandoActive(state);
  const length = state.indexed === undefined ? 0 : indexedLength(state);
  const names =
    state.named === undefined || state.named.enumerable === false
      ? []
      : namedKeys(state).filter(
          (key) =>
            !nativeMemberMap.has(state.properties, key) &&
            !nativeMemberMap.has(state.methods, key) &&
            !(
              state.indexed !== undefined &&
              (key === "length" || canonicalIndex(key) !== undefined)
            )
        );
  const expandos = state.expandos ? Object.keys(state.expandos.values) : [];
  const size =
    expandos.length +
    length +
    nativeMemberMap.size(state.properties) +
    nativeMemberMap.size(state.methods) +
    names.length;
  state.controller.checkLength(size);
  state.controller.chargeWork(size + 1);
  return [
    ...Array.from({ length }, (_entry, index) => String(index)),
    ...nativeMemberMap.keys(state.properties),
    ...nativeMemberMap.keys(state.methods),
    ...names,
    ...expandos
  ];
}

export function hasHostObjectMember(
  value: SandboxObject,
  key: string | symbol,
  enumerableOnly = false
): boolean {
  const state = readGuestObject(value)!;
  state.controller.assertActive();
  state.controller.chargeWork();
  assertExpandoActive(state);
  const expando = state.expandos && Object.getOwnPropertyDescriptor(state.expandos.values, key);
  if (expando) return !enumerableOnly || expando.enumerable === true;
  if (typeof key === "symbol") return false;
  if (state.indexed !== undefined) {
    if (key === "length") return !enumerableOnly;
    const index = canonicalIndex(key);
    if (index !== undefined) return index < state.indexed.maxLength && index < indexedLength(state);
  }
  if (nativeMemberMap.has(state.properties, key) || nativeMemberMap.has(state.methods, key))
    return true;
  return (
    state.named !== undefined &&
    !(enumerableOnly && state.named.enumerable === false) &&
    namedKeys(state).includes(key)
  );
}

export function measureHostObjectData(value: SandboxObject): number {
  return readGuestObject(value)!.memberDataUnits;
}

export function getHostObjectIterator(value: SandboxObject): SandboxIterator | undefined {
  const state = readGuestObject(value)!;
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

function namedMutationKeys(state: HostObjectState, key: string, create: boolean): string[] {
  state.controller.chargeWork(key.length);
  state.controller.checkString(key);
  if (
    ["constructor", "prototype", "__proto__"].includes(key) ||
    nativeMemberMap.has(state.properties, key) ||
    nativeMemberMap.has(state.methods, key) ||
    (state.indexed !== undefined && (key === "length" || canonicalIndex(key) !== undefined))
  )
    throw new TypeError(`Host member '${key}' is protected from named mutation.`);
  const named = state.named!;
  if (key.length > named.maxKeyCodeUnits)
    throw new RangeError("Named key exceeds maximum UTF-16 code units.");
  const keys = namedKeys(state);
  if (create && !keys.includes(key)) {
    const length = keys.length + 1;
    if (length > named.maxKeys) throw new RangeError("Named keys exceed maxKeys.");
    state.controller.checkLength(length);
    let units = key.length;
    for (const existing of keys) units += existing.length;
    if (units > named.maxKeyCodeUnits)
      throw new RangeError("Named keys exceed maximum UTF-16 code units.");
    state.controller.checkTemporaryDataSize(1 + length + units);
  }
  return keys;
}

function namedKeys(state: HostObjectState): string[] {
  const named = state.named!;
  return state.controller.read(named.keys, (value) => {
    if (!Array.isArray(value) || types.isProxy(value))
      throw new TypeError("Named keys must be a dense own-data array of strings, not a proxy.");
    const length = Object.getOwnPropertyDescriptor(value, "length")!.value as number;
    if (length > named.maxKeys) throw new RangeError("Named keys exceed maxKeys.");
    state.controller.checkLength(length);
    state.controller.chargeWork(length + 1);
    if (Reflect.ownKeys(value).length !== length + 1)
      throw new TypeError("Named keys must contain only dense own-data indices and length.");
    const result: string[] = [];
    const seen = new Set<string>();
    let units = 0;
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        typeof descriptor.value !== "string"
      )
        throw new TypeError(
          "Named keys require dense own string data, not accessors or sparse arrays."
        );
      const key = descriptor.value;
      units += key.length;
      if (units > named.maxKeyCodeUnits)
        throw new RangeError("Named keys exceed maximum UTF-16 code units.");
      state.controller.chargeWork(key.length);
      if (seen.has(key)) throw new TypeError("Named keys must be distinct.");
      if (["constructor", "prototype", "__proto__"].includes(key))
        throw new TypeError(`Reserved named host member '${key}'.`);
      seen.add(key);
      result.push(key);
    }
    state.controller.checkTemporaryDataSize(1 + length + units);
    return result;
  }) as string[];
}

function expandoKeyUnits(key: string | symbol): number {
  return typeof key === "string" ? key.length : key.description?.length ?? 0;
}

function assertExpandoActive(state: HostObjectState): void {
  const result = state.expandos?.assertActive?.();
  if (types.isPromise(result)) void Promise.resolve(result).catch(() => undefined);
  if (result !== undefined) throw new TypeError("Guest expando assertActive must return undefined.");
}

function validateExpandoKey(state: HostObjectState, key: string | symbol, create = true): void {
  if (
    typeof key === "string" &&
    (["constructor", "prototype", "__proto__"].includes(key) ||
      nativeMemberMap.has(state.properties, key) ||
      nativeMemberMap.has(state.methods, key) ||
      (state.indexed && (key === "length" || canonicalIndex(key) !== undefined)))
  )
    throw new TypeError("Host member is protected from guest expando mutation.");
  const expandos = state.expandos!;
  const keys = Reflect.ownKeys(expandos.values);
  if (create && !Object.hasOwn(expandos.values, key)) keys.push(key);
  state.controller.chargeWork(keys.length + 1);
  if (keys.length > expandos.maxKeys) throw new RangeError("Guest expandos exceed maxKeys.");
  let units = 0;
  for (const key of keys) units += expandoKeyUnits(key);
  if (units > expandos.maxKeyCodeUnits) throw new RangeError("Guest expandos exceed maximum UTF-16 code units.");
  state.controller.checkLength(keys.length);
  if (typeof key === "string") state.controller.checkString(key);
}

export function getHostObjectSymbolKeys(value: SandboxObject): symbol[] {
  const state = readGuestObject(value)!;
  state.controller.assertActive();
  assertExpandoActive(state);
  state.controller.chargeWork((state.expandos ? Reflect.ownKeys(state.expandos.values).length : 0) + 1);
  return state.expandos ? Object.getOwnPropertySymbols(state.expandos.values) : [];
}

export function hostObjectGuestRoot(value: HostObject | SandboxObject): SandboxObject | undefined {
  return (readHostObject(value) ?? readGuestObject(value)!).expandos?.values;
}

export function hostObjectGuestRoots(value: HostObject | SandboxObject): SandboxValue[] {
  const state = readHostObject(value) ?? readGuestObject(value)!;
  return state.expandos ? [state.expandos.values] : [];
}
