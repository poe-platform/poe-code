import { expect, it } from "vitest";
import { Temporal as TemporalBackend } from "temporal-polyfill/full/implementation";
import { cloneSandboxValue, deepCopyFromSandbox, deepCopyToSandbox } from "./values.js";
import { createSandboxTemporalPlainTime, hostTemporalPlainTimeFields, temporalPlainTimeFields } from "./temporal-plain-time.js";
import { hasNullObjectPrototype, setSandboxPrototype } from "./object-model.js";

const NativePlainTime = (globalThis as typeof globalThis & { Temporal?: typeof TemporalBackend }).Temporal?.PlainTime;
const HostPlainTime = NativePlainTime ?? TemporalBackend.PlainTime;
const constructors = [TemporalBackend.PlainTime, ...(NativePlainTime === undefined ? [] : [NativePlainTime])];
const fields = { hour: 23, minute: 59, second: 58, millisecond: 997, microsecond: 998, nanosecond: 999 };

it("copies private fields, aliases, symbol descriptors and frozen cycles", () => {
  const value = createSandboxTemporalPlainTime(fields);
  const key = Symbol("self");
  Object.defineProperty(value, key, { value });
  Object.freeze(value);
  setSandboxPrototype(value, null);
  const copy = cloneSandboxValue([value, value, key]);
  if (!Array.isArray(copy) || typeof copy[2] !== "symbol") throw new Error("Invalid graph");
  expect(copy[0]).not.toBe(value);
  expect(copy[0]).toBe(copy[1]);
  expect(temporalPlainTimeFields(copy[0])).toEqual(fields);
  expect(Object.getOwnPropertyDescriptor(copy[0], copy[2])).toEqual({ value: copy[0], writable: false, enumerable: false, configurable: false });
  expect(Object.isFrozen(copy[0])).toBe(true);
  expect(hasNullObjectPrototype(copy[0] as object)).toBe(true);
});

it.each(constructors)("imports exact host fields and frozen aliases (%#)", Constructor => {
  const value = new Constructor(23, 59, 58, 997, 998, 999);
  Object.defineProperty(value, "self", { value });
  Object.freeze(value);
  const copy = deepCopyToSandbox([value, value]);
  if (!Array.isArray(copy)) throw new Error("Invalid graph");
  expect(copy[0]).toBe(copy[1]);
  expect(temporalPlainTimeFields(copy[0])).toEqual(fields);
  expect(Object.getOwnPropertyDescriptor(copy[0], "self")).toEqual({ value: copy[0], writable: false, enumerable: false, configurable: false });
  expect(Object.isFrozen(copy[0])).toBe(true);
});

it.each(constructors)("keeps shadowing data separate from imported private fields (%#)", Constructor => {
  const value = new Constructor(23);
  Object.defineProperty(value, "hour", { value: 7 });
  const copy = deepCopyToSandbox(value);
  expect(temporalPlainTimeFields(copy).hour).toBe(23);
  expect(Object.getOwnPropertyDescriptor(copy, "hour")?.value).toBe(7);
});

it("exports a host-branded value with exact fields and frozen aliases", () => {
  const value = createSandboxTemporalPlainTime(fields);
  Object.defineProperty(value, "self", { value });
  Object.freeze(value);
  const copy = deepCopyFromSandbox([value, value]) as Array<InstanceType<typeof HostPlainTime> & { self: unknown }>;
  expect(copy[0]).toBe(copy[1]);
  expect(copy[0]).toBeInstanceOf(HostPlainTime);
  expect(copy[0]!.toJSON()).toBe("23:59:58.997998999");
  expect(copy[0]!.self).toBe(copy[0]);
  expect(Object.isFrozen(copy[0])).toBe(true);
});

it("round-trips explicit null prototypes while preserving private host branding", () => {
  const value = createSandboxTemporalPlainTime(fields);
  setSandboxPrototype(value, null);
  const exported = deepCopyFromSandbox(value);
  expect(Object.getPrototypeOf(exported)).toBeNull();
  const getter = Object.getOwnPropertyDescriptor(HostPlainTime.prototype, "hour")!.get!;
  expect(getter.call(exported)).toBe(23);
  const imported = deepCopyToSandbox(exported);
  expect(temporalPlainTimeFields(imported)).toEqual(fields);
  expect(hasNullObjectPrototype(imported as object)).toBe(true);
});

it.each(constructors)("rejects forged host brands without reading own getters (%#)", Constructor => {
  let reads = 0;
  const forged = Object.create(Constructor.prototype);
  Object.defineProperty(forged, "hour", { get() { reads++; return 23; } });
  expect(() => deepCopyToSandbox(forged)).toThrow(TypeError);
  expect(reads).toBe(0);
});

it.each(["import", "export", "clone"] as const)("rejects accessors without running them during %s", direction => {
  const value = direction === "import" ? new TemporalBackend.PlainTime() : createSandboxTemporalPlainTime();
  let reads = 0;
  Object.defineProperty(value, "label", { get() { reads++; return 7; } });
  const copy = direction === "import" ? deepCopyToSandbox : direction === "export" ? deepCopyFromSandbox : cloneSandboxValue;
  expect(() => copy(value as never)).toThrow(TypeError);
  expect(reads).toBe(0);
});

it.each(constructors)("rejects host PlainTime in structured-clone mode (%#)", Constructor => {
  expect(() => cloneSandboxValue(new Constructor() as never, { structuredClone: true }))
    .toThrow(expect.objectContaining({ name: "DataCloneError" }));
});

it("does not invoke proxy traps while recognizing host PlainTime values", () => {
  let reads = 0;
  const value = new Proxy(new TemporalBackend.PlainTime(), {
    getPrototypeOf() { reads++; throw new Error("prototype trap"); },
    get() { reads++; throw new Error("get trap"); }
  });
  expect(hostTemporalPlainTimeFields(value)).toBeUndefined();
  expect(reads).toBe(0);
});

it("rejects custom prototypes on tracked host exports", () => {
  const exported = deepCopyFromSandbox(createSandboxTemporalPlainTime());
  Object.setPrototypeOf(exported, { custom: true });
  expect(() => deepCopyToSandbox(exported)).toThrow(TypeError);
});

it("preserves shadowing descriptors independently of exported private fields", () => {
  const value = createSandboxTemporalPlainTime({ hour: 23 });
  Object.defineProperty(value, "hour", { value: 7 });
  const exported = deepCopyFromSandbox(value);
  expect(Object.getOwnPropertyDescriptor(exported, "hour")).toEqual({ value: 7, writable: false, enumerable: false, configurable: false });
  expect(Object.getOwnPropertyDescriptor(HostPlainTime.prototype, "hour")!.get!.call(exported)).toBe(23);
});
