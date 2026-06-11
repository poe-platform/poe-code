import { describe, expect, it } from "vitest";

import { run } from "./run.js";

describe("sandbox integrity at the run boundary", () => {
  it.each([
    [
      "object dot __proto__",
      "const value = {}; value.__proto__ = { polluted: true }; return value;"
    ],
    [
      "object computed constructor",
      'const value = {}; const key = "constructor"; value[key] = { polluted: true }; return value;'
    ],
    [
      "object dot prototype",
      "const value = {}; value.prototype = { polluted: true }; return value;"
    ],
    [
      "object logical __proto__",
      "const value = {}; value.__proto__ ??= { polluted: true }; return value;"
    ],
    ["object compound constructor", 'const value = {}; value.constructor += "host"; return value;'],
    ["object update prototype", "const value = {}; value.prototype++; return value;"],
    [
      "object destructuring member target",
      "const value = {}; ({ next: value.__proto__ } = { next: { polluted: true } }); return value;"
    ],
    [
      "array dot __proto__",
      "const value = []; value.__proto__ = { polluted: true }; return value;"
    ],
    [
      "array computed constructor",
      'const value = []; const key = "constructor"; value[key] = { polluted: true }; return value;'
    ],
    [
      "array dot prototype",
      "const value = []; value.prototype = { polluted: true }; return value;"
    ],
    [
      "array destructuring member target",
      "const value = []; [value.__proto__] = [{ polluted: true }]; return value;"
    ],
    [
      "computed object literal __proto__",
      'const key = "__proto__"; return { [key]: { polluted: true } };'
    ],
    [
      "Object.fromEntries __proto__",
      'return Object.fromEntries([["__proto__", { polluted: true }]]);'
    ],
    [
      "Object.assign __proto__",
      'const value = {}; Object.assign(value, JSON.parse("{\\"__proto__\\":{\\"polluted\\":true}}")); return value;'
    ],
    [
      "Object.assign array __proto__",
      'const value = []; Object.assign(value, JSON.parse("{\\"__proto__\\":{\\"polluted\\":true}}")); return value;'
    ]
  ])("keeps %s writes from changing host prototypes", async (_label, source) => {
    const result = await run(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const value = result.returnValue as object;
    const expectedPrototype = Array.isArray(value) ? Array.prototype : null;
    expect(Object.getPrototypeOf(value)).toBe(expectedPrototype);
    expect((value as { polluted?: unknown }).polluted).toBeUndefined();

    const freshResult = await run(Array.isArray(value) ? "return [];" : "return {};");
    expect(freshResult.ok).toBe(true);
    if (!freshResult.ok) return;
    const fresh = freshResult.returnValue as object;
    expect(Object.getPrototypeOf(fresh)).toBe(expectedPrototype);
    expect((fresh as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("stores hostile Map keys and Set values without affecting host prototypes", async () => {
    const result = await run(`
      const map = new Map();
      map.set("__proto__", { polluted: true });
      map.set("constructor", { polluted: true });
      map.set("prototype", { polluted: true });
      const set = new Set();
      set.add("__proto__");
      set.add("constructor");
      set.add("prototype");
      return {
        mapKeys: [...map.keys()],
        mapValues: [...map.values()],
        setValues: [...set],
        freshObject: {},
        freshArray: []
      };
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const value = result.returnValue as {
      mapKeys: string[];
      mapValues: Array<{ polluted: boolean }>;
      setValues: string[];
      freshObject: object;
      freshArray: unknown[];
    };
    expect(value.mapKeys).toEqual(["__proto__", "constructor", "prototype"]);
    expect(value.mapValues).toEqual([{ polluted: true }, { polluted: true }, { polluted: true }]);
    expect(value.setValues).toEqual(["__proto__", "constructor", "prototype"]);
    expect(Object.getPrototypeOf(value.freshObject)).toBeNull();
    expect(Object.getPrototypeOf(value.freshArray)).toBe(Array.prototype);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    expect(([] as unknown as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("keeps prototype-bearing member reads closed across value kinds", async () => {
    const result = await run(`
      const closure = function () {};
      return [
        ({}).__proto__, ({}).constructor, ({}).prototype,
        [].__proto__, [].constructor, [].prototype,
        "value".__proto__, "value".constructor, "value".prototype,
        (1).__proto__, (1).constructor, (1).prototype,
        closure.__proto__, closure.constructor, closure.prototype,
        typeof ([1].toSorted)
      ];
    `);

    expect(result).toMatchObject({
      ok: true,
      returnValue: [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "function"
      ]
    });
  });

  it("allows supported closed-world methods and directs unsupported member calls", async () => {
    await expect(run("return [2, 1].toSorted();")).resolves.toMatchObject({
      ok: true,
      returnValue: [1, 2]
    });
    await expect(run("return [1].shuffle();")).rejects.toMatchObject({
      name: "TypeError",
      message: "Array#shuffle is not a supported method."
    });
  });

  it.each([
    ["closure constructor", "return (function () {}).constructor;"],
    ["object constructor", "return ({}).constructor;"],
    ["array constructor", "return [].constructor;"]
  ])("does not expose a Function constructor through %s", async (_label, source) => {
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: undefined });
  });

  it.each([
    [
      "closure gadget",
      'return (function () {}).constructor("return process")();',
      "Function#constructor is not a supported method."
    ],
    [
      "object gadget",
      'return ({}).constructor("return process")();',
      "Attempted to call a non-function value."
    ],
    [
      "array gadget",
      'return [].constructor("return process")();',
      "Array#constructor is not a supported method."
    ]
  ])("fails closed for the %s", async (_label, source, message) => {
    await expect(run(source)).rejects.toMatchObject({
      name: "TypeError",
      message
    });
  });

  it("does not propagate hostile JSON keys through spread, destructuring, or cloning", async () => {
    const result = await run(`
      const hostile = JSON.parse("{\\"__proto__\\":{\\"polluted\\":true},\\"constructor\\":7,\\"prototype\\":8,\\"safe\\":9}");
      const spread = { ...hostile };
      const { safe, ...rest } = hostile;
      const clone = structuredClone(hostile);
      return { hostile, spread, rest, clone, safe, freshObject: {}, freshArray: [] };
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const value = result.returnValue as Record<string, Record<string, unknown> | unknown>;
    for (const key of ["hostile", "spread", "rest", "clone"] as const) {
      const object = value[key] as Record<string, unknown>;
      expect(Object.getPrototypeOf(object)).toBeNull();
      expect(object.polluted).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(object, "__proto__")).toMatchObject({
        enumerable: true,
        value: { polluted: true }
      });
    }
    expect(value.safe).toBe(9);
    expect(Object.getPrototypeOf(value.freshObject)).toBeNull();
    expect(Object.getPrototypeOf(value.freshArray)).toBe(Array.prototype);
  });

  it("rejects host objects with a custom prototype before sandbox evaluation", async () => {
    const hostile = Object.create({ polluted: true }) as Record<string, unknown>;
    hostile.safe = 1;

    await expect(run("return input;", { bindings: { input: hostile } })).rejects.toThrow(
      "Unsupported sandbox value at <root>: Object"
    );
  });

  it("rejects host accessor properties before sandbox evaluation", async () => {
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "secret", {
      enumerable: true,
      get: () => "host secret"
    });

    await expect(run("return input;", { bindings: { input: hostile } })).rejects.toThrow(
      "Unsupported sandbox value at <root>.secret: accessor property"
    );
  });
});
