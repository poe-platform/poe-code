import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { deepCopyToSandbox } from "./values.js";

it.each(["Map", "Set"] as const)(
  "rejects a native %s subclass without executing its size getter",
  async (kind) => {
    const getter = vi.fn(() => {
      throw new Error("host getter executed");
    });
    const value = kind === "Map" ? new (class extends Map {})() : new (class extends Set {})();
    Object.defineProperty(Object.getPrototypeOf(value), "size", { get: getter });
    expect(() => deepCopyToSandbox(value)).toThrow("subclasses");
    await expect(run("return value;", { bindings: { value } })).rejects.toThrow("subclasses");
    expect(getter).not.toHaveBeenCalled();
  }
);

it.each(["Map", "Set"] as const)(
  "rejects a native %s iterator accessor without execution",
  async (kind) => {
    const value = kind === "Map" ? new Map([[1, 2]]) : new Set([1]);
    const getter = vi.fn(() => {
      throw new Error("host iterator getter executed");
    });
    Object.defineProperty(value, Symbol.iterator, { get: getter });
    await expect(run("return value;", { bindings: { value } })).rejects.toThrow("accessor");
    expect(getter).not.toHaveBeenCalled();
  }
);

it.each(["Map", "Set"] as const)(
  "preserves native %s data metadata and uses its intrinsic entries",
  async (kind) => {
    const key = Symbol("key");
    const value = kind === "Map" ? new Map([[1, 2]]) : new Set([1]);
    Object.defineProperty(value, key, { value });
    Object.defineProperty(value, "key", { value: key });
    Object.defineProperty(value, "self", { value });
    Object.freeze(value);
    const result = await run(
      "return value.self===value && value[value.key]===value && Object.isFrozen(value) && value.size===1;",
      { bindings: { value } }
    );
    expect(result).toMatchObject({ ok: true, returnValue: true });
  }
);
