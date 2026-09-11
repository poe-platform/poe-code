import { expect, it } from "vitest";
import { SnapshotValidationError, validateSnapshotData } from "./validation.js";

it("accepts non-enumerable data properties without dropping their values", () => {
  const value = Object.create(null);
  Object.defineProperty(value, "hidden", {value: [1, 2, 3]});
  expect(() => validateSnapshotData(value)).not.toThrow();
  Object.defineProperty(value, "invalid", {value: undefined});
  expect(() => validateSnapshotData(value)).toThrow(SnapshotValidationError);
});

it.each(["plain", "a-b", "0"])("rejects accessor %s without invoking it", key => {
  let reads = 0;
  const value = Object.defineProperty({}, key, {get() {reads++; return 1;}});
  expect(() => validateSnapshotData(value)).toThrow(SnapshotValidationError);
  expect(reads).toBe(0);
});

it("rejects proxies before invoking structural traps", () => {
  let reads = 0;
  const value = new Proxy({}, {
    ownKeys() {reads++; return [];},
    getOwnPropertyDescriptor() {reads++; return undefined;},
    getPrototypeOf() {reads++; return Object.prototype;}
  });
  expect(() => validateSnapshotData(value)).toThrow(SnapshotValidationError);
  expect(reads).toBe(0);
});

it.each([
  () => ({[Symbol("key")]: 1}),
  () => Object.create({inherited: 1}),
  () => new Array(2),
  () => Object.assign([1], {named: 2}),
  () => Object.assign([1], {"01": 2}),
  () => Object.assign(new Array(1), {named: 2})
])("retains structural data restrictions %#", create => {
  expect(() => validateSnapshotData(create())).toThrow(SnapshotValidationError);
});
