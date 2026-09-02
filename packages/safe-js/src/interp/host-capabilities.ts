import { readDataRecord, type HostOperation } from "../extensions.js";
import type { SandboxClosure, SandboxObject, SandboxValue } from "./values.js";

declare const hostObjectBrand: unique symbol;
declare const sandboxHostObjectBrand: unique symbol;
type SandboxHostObject = SandboxObject & { readonly [sandboxHostObjectBrand]: true };
export type HostObject = Readonly<Record<string, never>> & { readonly [hostObjectBrand]: true };
export type HostObjectDefinition = {
  properties?: Record<string, { get?: () => unknown; set?: (value: unknown) => void }>;
  methods?: Record<string, HostOperation>;
};
export type HostObjectController = {
  owner: object;
  assertActive(): void;
  chargeWork(units?: number): void;
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
};
type GuestCallbackState = { owner: object; closure?: SandboxClosure; assertActive(): void };
const hostObjects = new WeakMap<object, HostObjectState>();
const guestObjects = new WeakMap<object, HostObjectState>();
const guestCallbacks = new WeakMap<object, GuestCallbackState>();

export function createLiveHostObject(
  definition: HostObjectDefinition,
  controller: HostObjectController
): HostObject {
  const input = readDataRecord(definition, "Host object definition");
  if (Object.keys(input).some((key) => key !== "properties" && key !== "methods"))
    throw new TypeError("Unknown host object definition field.");
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
  const state = { host, guest, controller, properties, methods };
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
    (hostObjects.has(value) || guestObjects.has(value) || guestCallbacks.has(value))
  );
}

export function importHostCapability(value: object, owner: object): SandboxValue {
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
}

export function getHostObjectMember(value: SandboxObject, key: string): SandboxValue {
  const state = guestObjects.get(value)!;
  state.controller.assertActive();
  state.controller.chargeWork();
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
  return [...state.properties.keys(), ...state.methods.keys()];
}
