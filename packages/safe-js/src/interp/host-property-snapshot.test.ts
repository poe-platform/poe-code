import { expect, it, vi } from "vitest";
import {
  createLiveHostObject,
  getHostObjectMember,
  importHostCapability,
  measureHostObjectData,
  revokeHostObject,
  setHostObjectMember,
  type HostObjectController,
  type HostObjectDefinition
} from "./host-capabilities.js";
import type { SandboxObject, SandboxValue } from "./values.js";

function controller(): HostObjectController {
  return {
    owner: {},
    assertActive: vi.fn(),
    chargeWork: vi.fn(),
    chargeGuestData: vi.fn(),
    checkLength: vi.fn(),
    checkString: vi.fn(),
    checkTemporaryDataSize: vi.fn(),
    read: (operation) => operation() as SandboxValue,
    write: (operation, value) => operation(value),
    method: () => {
      throw new Error("Unexpected method registration");
    }
  };
}

it("snapshots property operations while preserving live state and revocation", () => {
  let value = 1;
  const get = vi.fn(() => value);
  const set = vi.fn((next: unknown) => {
    value = next as number;
  });
  const property: { get: () => unknown; set: (next: unknown) => void } = { get, set };
  const definition = { properties: { value: property } };
  const control = controller();
  const host = createLiveHostObject(definition, control);
  const guest = importHostCapability(host, control.owner) as SandboxObject;
  expect(get).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
  property.get = () => 99;
  property.set = () => {
    throw new Error("Replaced setter");
  };
  definition.properties.value = { get: () => 100, set: () => {} };
  expect(getHostObjectMember(guest, "value")).toBe(1);
  setHostObjectMember(guest, "value", 7);
  expect(getHostObjectMember(guest, "value")).toBe(7);
  expect(measureHostObjectData(guest)).toBe(6);
  expect(set).toHaveBeenCalledWith(7);
  revokeHostObject(host, control.owner);
  expect(getHostObjectMember(guest, "value")).toBeUndefined();
  expect(measureHostObjectData(guest)).toBe(0);
  expect(get).toHaveBeenCalledTimes(2);
});

it("does not inherit absent operations from later native prototype changes", () => {
  const control = controller();
  const host = createLiveHostObject(
    { properties: { read: { get: () => 1 }, write: { set: () => {} }, empty: {} } },
    control
  );
  const guest = importHostCapability(host, control.owner) as SandboxObject;
  const get = vi.fn(() => 99);
  const set = vi.fn();
  const oldGet = Object.getOwnPropertyDescriptor(Object.prototype, "get");
  const oldSet = Object.getOwnPropertyDescriptor(Object.prototype, "set");
  let reads: unknown[] = [];
  let failure: unknown;
  try {
    Object.defineProperty(
      Object.prototype,
      "get",
      Object.assign(Object.create(null), { value: get, configurable: true })
    );
    Object.defineProperty(
      Object.prototype,
      "set",
      Object.assign(Object.create(null), { value: set, configurable: true })
    );
    reads = [getHostObjectMember(guest, "write"), getHostObjectMember(guest, "empty")];
    try {
      setHostObjectMember(guest, "read", 2);
    } catch (error) {
      failure = error;
    }
  } finally {
    if (oldGet)
      Object.defineProperty(Object.prototype, "get", Object.assign(Object.create(null), oldGet));
    else delete (Object.prototype as { get?: unknown }).get;
    if (oldSet)
      Object.defineProperty(Object.prototype, "set", Object.assign(Object.create(null), oldSet));
    else delete (Object.prototype as { set?: unknown }).set;
  }
  expect(reads).toEqual([undefined, undefined]);
  expect(failure).toMatchObject({ message: "Host property 'read' is not writable." });
  expect(get).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
});

it.each([
  { get: 1 },
  { set: 1 },
  { get: () => 1, extra: true },
  Object.defineProperty({}, "get", {
    get: () => {
      throw new Error("Accessor executed");
    },
    enumerable: true
  })
])("rejects invalid operation records before registration", (property) => {
  const control = controller();
  expect(() =>
    createLiveHostObject({ properties: { value: property } } as HostObjectDefinition, control)
  ).toThrow(TypeError);
  expect(control.chargeWork).not.toHaveBeenCalled();
});

it("rejects proxy operation records without invoking their traps", () => {
  const trap = vi.fn(() => {
    throw new Error("Proxy trap executed");
  });
  const property = new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap });
  expect(() => createLiveHostObject({ properties: { value: property } }, controller())).toThrow(
    "plain data record"
  );
  expect(trap).not.toHaveBeenCalled();
});
