import { expect, it } from "vitest";
import { measureSandboxData } from "./values.js";
import { numericTypedArrayConstructors } from "./typed-array-constructors.js";

it.each(Object.entries(numericTypedArrayConstructors))("charges a %s symbol property's string payload once", (_name, Native) => {
  const value = new Native(2);
  const key = Symbol("payload");
  Object.defineProperty(value, key, {value: "", writable: true});
  const before = measureSandboxData([value]);
  Object.defineProperty(value, key, {value: "x".repeat(400)});
  expect(measureSandboxData([value]) - before).toBe(400);
});

it.each(Object.entries(numericTypedArrayConstructors))("charges one property slot and symbol identity for a %s symbol key", (_name, Native) => {
  const value = new Native(2);
  const before = measureSandboxData([value]);
  Object.defineProperty(value, Symbol("payload"), {value: ""});
  expect(measureSandboxData([value]) - before).toBe(1 + 1 + "payload".length);
});

it("does not invoke symbol getters and retains symbol-keyed cycles once", () => {
  const value = new Float32Array(2);
  const before = measureSandboxData([value]);
  let reads = 0;
  Object.defineProperty(value, Symbol("get"), {get() { reads++; return "hidden"; }});
  Object.defineProperty(value, Symbol("self"), {value});
  expect(measureSandboxData([value]) - before).toBe(5 + 6);
  expect(reads).toBe(0);
});
