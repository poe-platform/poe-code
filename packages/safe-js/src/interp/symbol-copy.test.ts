import { describe, expect, it } from "vitest";
import { deepCopyFromSandbox, deepCopyToSandbox } from "./values.js";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
import { boxedValue, isSandboxBox } from "./boxed.js";

it("preserves symbol-keyed wrapper properties and cycles through copying", () => {
  const payload = Symbol("payload");
  const key = Symbol("self");
  const source = Object(payload);
  Object.defineProperty(source, key, { value: source });
  const copied = deepCopyToSandbox(source);
  if (!isSandboxBox(copied)) throw new Error("Expected copied Symbol box");
  expect(boxedValue(copied)).toBe(payload);
  expect(Object.getOwnPropertyDescriptor(copied, key)).toEqual({ value: copied, enumerable: false, writable: false, configurable: false });
  const exported = deepCopyFromSandbox(copied);
  expect(Symbol.prototype.valueOf.call(exported)).toBe(payload);
  expect(Object.getOwnPropertyDescriptor(exported, key)).toEqual({ value: exported, enumerable: false, writable: false, configurable: false });
});

describe.each(["object", "array"])("symbol-keyed %s copies", kind => {
  it("preserves distinct keys, shared values and cycles across ingress and egress", () => {
    const first = Symbol("key");
    const second = Symbol("key");
    const source = Object.assign(kind === "array" ? [] : {}, { [first]: { value: 7 } });
    Object.defineProperty(source, second, { value: source, enumerable: true });
    const copied = deepCopyToSandbox(source);
    const exported = deepCopyFromSandbox(copied);
    for (const target of [copied, exported]) {
      expect(target).not.toBe(source);
      expect(Object.getOwnPropertySymbols(target)).toEqual([first, second]);
      expect(Object.getOwnPropertyDescriptor(target, first)?.value).toEqual({ value: 7 });
      expect(Object.getOwnPropertyDescriptor(target, first)?.value).not.toBe(source[first]);
      expect(Object.getOwnPropertyDescriptor(target, second)?.value).toBe(target);
      expect(Array.isArray(target)).toBe(kind === "array");
    }
  });

  it("rejects an enumerable symbol getter without invoking it", () => {
    let reads = 0;
    const source = kind === "array" ? [] : {};
    Object.defineProperty(source, Symbol("key"), { enumerable: true, get() { reads++; return 7; } });
    expect(() => deepCopyToSandbox(source)).toThrow(/accessor property/);
    expect(() => deepCopyFromSandbox(source)).toThrow(/accessor property/);
    expect(reads).toBe(0);
  });
});

it("enforces depth limits along symbol-only copy paths", () => {
  const key = Symbol("next");
  let source = {};
  for (let depth = 0; depth <= MAX_DATA_DEPTH; depth++) source = { [key]: source };
  for (const copy of [deepCopyToSandbox, deepCopyFromSandbox]) {
    expect(() => copy(source)).toThrow(expect.objectContaining({ name: "SandboxError", budget: "dataDepth" }));
  }
});
