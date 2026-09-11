import { types } from "node:util";
import { expect, it } from "vitest";
import { NativeSuppressedError } from "./native-suppressed-error.js";

it("constructs genuine host errors with standard payload descriptors", () => {
  const error = NativeSuppressedError(1, 2, "text");
  expect(types.isNativeError(error)).toBe(true);
  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(NativeSuppressedError);
  expect(error).toMatchObject({ name: "SuppressedError", message: "text", error: 1, suppressed: 2 });
  expect(Object.getOwnPropertyDescriptor(error, "error")).toEqual({ value: 1, enumerable: false, writable: true, configurable: true });
  expect(NativeSuppressedError.length).toBe(3);
});

it("supports subclass construction without installing a host global", () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "SuppressedError");
  class Derived extends NativeSuppressedError {}
  const error = new Derived(1, 2);
  expect(error).toBeInstanceOf(Derived);
  expect(Object.hasOwn(error, "message")).toBe(false);
  expect(Object.getOwnPropertyDescriptor(globalThis, "SuppressedError")).toEqual(before);
});
