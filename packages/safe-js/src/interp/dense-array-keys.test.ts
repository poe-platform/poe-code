import { expect, it, vi } from "vitest";
import { measureSandboxData } from "./values.js";

it("avoids full own-name enumeration for dense enumerable native indices", () => {
  const value = Array.from({ length: 1000 }, (_, index) => index);
  Object.defineProperty(value, "hiddenName", { value: "ignored transport metadata" });
  Object.assign(value, { extra: "also ignored" });
  const names = vi.spyOn(Object, "getOwnPropertyNames");
  try {
    expect(measureSandboxData([value])).toBe(1001);
    expect(names.mock.calls.filter(([object]) => object === value)).toHaveLength(0);
  } finally { names.mockRestore(); }
});

it("falls back for hidden indices even when named keys fill the enumerable count", () => {
  const value = ["a", "hidden", "c"];
  Object.defineProperty(value, "1", { enumerable: false });
  Object.assign(value, { "02": "ignored", extra: "ignored" });
  expect(measureSandboxData([value])).toBe(12);
});

it("does not invoke enumerable index getters while proving density", () => {
  const value = [1, 2];
  const read = vi.fn(() => "secret");
  Object.defineProperty(value, "0", { get: read });
  expect(measureSandboxData([value])).toBe(3);
  expect(read).not.toHaveBeenCalled();
});

it("retains descriptor-based proxy index lookup when ownKeys omits them", () => {
  const value = new Proxy(["abc"], { ownKeys: () => ["length"] });
  expect(measureSandboxData([value])).toBe(5);
});
