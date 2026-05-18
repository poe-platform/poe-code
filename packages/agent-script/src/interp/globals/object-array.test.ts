import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { Budget, SandboxError } from "../budget.js";
import {
  createSandboxClosure,
  isSandboxClosure,
  type SandboxClosure,
  type SandboxObject
} from "../values.js";
import { createObjectArrayGlobals } from "./object-array.js";

describe("createObjectArrayGlobals", () => {
  it("exposes Object, Array, and coercion helpers", async () => {
    const globals = createObjectArrayGlobals({
      budget: new Budget()
    });
    const objectValue = {
      alpha: 1,
      beta: "two"
    };
    const assignTarget = {
      start: true
    };

    expect(await getClosure(getProperty(globals.Object, "keys")).call([objectValue])).toEqual([
      "alpha",
      "beta"
    ]);
    expect(await getClosure(getProperty(globals.Object, "values")).call([objectValue])).toEqual([
      1,
      "two"
    ]);
    expect(await getClosure(getProperty(globals.Object, "entries")).call([objectValue])).toEqual([
      ["alpha", 1],
      ["beta", "two"]
    ]);
    expect(
      await getClosure(getProperty(globals.Object, "fromEntries")).call([
        [
          ["left", 1],
          ["right", 2]
        ]
      ])
    ).toEqual({
      left: 1,
      right: 2
    });
    expect(await getClosure(getProperty(globals.Object, "freeze")).call([objectValue])).toBe(
      objectValue
    );
    expect(Object.isFrozen(objectValue)).toBe(true);
    expect(
      await getClosure(getProperty(globals.Object, "assign")).call([
        assignTarget,
        {
          extra: 2
        }
      ])
    ).toBe(assignTarget);
    expect(assignTarget).toEqual({
      start: true,
      extra: 2
    });

    expect(await getClosure(getProperty(globals.Array, "isArray")).call([[]])).toBe(true);
    expect(await getClosure(getProperty(globals.Array, "from")).call([[1, "two", false]])).toEqual([
      1,
      "two",
      false
    ]);
    expect(await getClosure(getProperty(globals.Array, "of")).call([1, "two", false])).toEqual([
      1,
      "two",
      false
    ]);

    expect(await globals.String.call([123])).toBe("123");
    expect(await globals.Number.call(["42.5"])).toBe(42.5);
    expect(await globals.Boolean.call([0])).toBe(false);
  });

  it("matches Object static edge behavior", async () => {
    const globals = createObjectArrayGlobals({
      budget: new Budget()
    });
    const keys = getClosure(getProperty(globals.Object, "keys"));
    const values = getClosure(getProperty(globals.Object, "values"));
    const entries = getClosure(getProperty(globals.Object, "entries"));
    const fromEntries = getClosure(getProperty(globals.Object, "fromEntries"));
    const freeze = getClosure(getProperty(globals.Object, "freeze"));
    const isFrozen = getClosure(getProperty(globals.Object, "isFrozen"));
    const assign = getClosure(getProperty(globals.Object, "assign"));

    expect(() => keys.call([null])).toThrow(TypeError);
    expect(() => keys.call([undefined])).toThrow(TypeError);
    expect(await keys.call(["ab"])).toEqual(["0", "1"]);
    expect(await values.call([{}])).toEqual([]);
    expect(await entries.call([{ a: 1 }])).toEqual([["a", 1]]);
    expect(await fromEntries.call([[["a", 1]]])).toEqual({ a: 1 });
    expect(await fromEntries.call([[]])).toEqual({});
    expect(() => fromEntries.call([null])).toThrow(TypeError);

    const protoEntryObject = await fromEntries.call([[["__proto__", 1]]]);
    expect(Object.hasOwn(protoEntryObject as object, "__proto__")).toBe(true);
    expect((protoEntryObject as Record<string, unknown>).__proto__).toBe(1);
    expect(Object.getPrototypeOf(protoEntryObject)).toBe(Object.prototype);

    const frozen = await freeze.call([{ a: 1 }]);
    expect(await freeze.call([frozen])).toBe(frozen);
    expect(await isFrozen.call([frozen])).toBe(true);
    expect(await isFrozen.call([{}])).toBe(false);

    expect(await assign.call([{}, { a: 1 }, { a: 2 }])).toEqual({ a: 2 });
    expect(await assign.call([{ a: 1 }, undefined, null, { b: 2 }])).toEqual({
      a: 1,
      b: 2
    });

    let getterCalls = 0;
    const getterSource = {
      get value() {
        getterCalls += 1;
        return "copied";
      }
    };
    expect(await assign.call([{}, getterSource])).toEqual({
      value: "copied"
    });
    expect(getterCalls).toBe(1);
  });

  it("matches Array and coercion static edge behavior", async () => {
    const globals = createObjectArrayGlobals({
      budget: new Budget()
    });
    const isArray = getClosure(getProperty(globals.Array, "isArray"));
    const from = getClosure(getProperty(globals.Array, "from"));
    const of = getClosure(getProperty(globals.Array, "of"));

    expect(await isArray.call([[]])).toBe(true);
    expect(await isArray.call(["a"])).toBe(false);
    expect(await isArray.call([{ length: 1 }])).toBe(false);
    expect(await from.call(["ab"])).toEqual(["a", "b"]);
    expect(await from.call([{ length: 3 }])).toEqual([undefined, undefined, undefined]);
    expect(await from.call([{ length: 3 }, createIndexMapper()])).toEqual([0, 1, 2]);
    expect(await of.call([7])).toEqual([7]);
    expect(await of.call([])).toEqual([]);

    expect(await globals.Number.call(["0x10"])).toBe(16);
    expect(await globals.Number.call([" "])).toBe(0);
    expect(await globals.Number.call([""])).toBe(0);
    expect(await globals.Number.call(["abc"])).toBeNaN();

    expect(await globals.Boolean.call([""])).toBe(false);
    expect(await globals.Boolean.call(["false"])).toBe(true);
    expect(await globals.Boolean.call([0])).toBe(false);
    expect(await globals.Boolean.call([NaN])).toBe(false);
  });

  it("documents frozen member writes as TypeError in the interpreter", async () => {
    const result = await run(
      [
        "const value = Object.freeze({ a: 1 });",
        "try {",
        "  value.a = 2;",
        "  return JSON.stringify(['mutated', value.a]);",
        "} catch (error) {",
        "  return JSON.stringify([error.name, value.a]);",
        "}"
      ].join("\n")
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify(["TypeError", 1])
    });
  });

  it("exposes String.raw as a static method", async () => {
    const globals = createObjectArrayGlobals({
      budget: new Budget()
    });
    const raw = getClosure(getClosureProperty(globals.String, "raw"));

    expect(await raw.call([{ raw: ["a", "b"] }, 1])).toBe("a1b");
    expect(await raw.call([{ raw: ["a", "b", "c"] }, 1])).toBe("a1bc");
    expect(await raw.call([{ raw: ["a"] }, 1])).toBe("a");
    expect(await raw.call([{ raw: ["a", "b"] }, 1, 2])).toBe("a1b");
    expect(await raw.call([{ raw: [] }])).toBe("");
    expect(() => raw.call([{}])).toThrow("String.raw requires a raw strings array.");
  });

  it("applies string and array budgets to produced values", () => {
    const stringGlobals = createObjectArrayGlobals({
      budget: new Budget({
        stringLength: 3
      })
    });
    const arrayGlobals = createObjectArrayGlobals({
      budget: new Budget({
        arrayLength: 1
      })
    });

    expect(() => stringGlobals.String.call(["toolong"])).toThrowError(
      expect.objectContaining({
        budget: "stringLength",
        current: 7,
        limit: 3
      } satisfies Partial<SandboxError>)
    );
    expect(() =>
      getClosure(getProperty(arrayGlobals.Object, "keys")).call([
        {
          alpha: 1,
          beta: 2
        }
      ])
    ).toThrowError(
      expect.objectContaining({
        budget: "arrayLength",
        current: 2,
        limit: 1
      } satisfies Partial<SandboxError>)
    );
  });

  it("supports Array.from with sandbox coercion callbacks", async () => {
    const globals = createObjectArrayGlobals({
      budget: new Budget()
    });

    await expect(
      getClosure(getProperty(globals.Array, "from")).call([["1", "2"], globals.Number])
    ).resolves.toEqual([1, 2]);
    await expect(
      getClosure(getProperty(globals.Array, "from")).call(["10", globals.Number])
    ).resolves.toEqual([1, 0]);
  });

  it("exposes strict Number static predicate methods", async () => {
    const globals = createObjectArrayGlobals({
      budget: new Budget()
    });

    const isFinite = getClosure(getClosureProperty(globals.Number, "isFinite"));
    const isNaN = getClosure(getClosureProperty(globals.Number, "isNaN"));
    const isInteger = getClosure(getClosureProperty(globals.Number, "isInteger"));

    expect(await isFinite.call([1])).toBe(true);
    expect(await isFinite.call([Infinity])).toBe(false);
    expect(await isFinite.call([NaN])).toBe(false);
    expect(await isFinite.call(["1"])).toBe(false);

    expect(await isNaN.call([NaN])).toBe(true);
    expect(await isNaN.call([1])).toBe(false);
    expect(await isNaN.call(["NaN"])).toBe(false);

    expect(await isInteger.call([1])).toBe(true);
    expect(await isInteger.call([1.5])).toBe(false);
    expect(await isInteger.call(["1"])).toBe(false);

    expect(isSandboxClosure(getClosureProperty(globals.Number, "isFinite"))).toBe(true);
    expect(isSandboxClosure(getClosureProperty(globals.Number, "isNaN"))).toBe(true);
    expect(isSandboxClosure(getClosureProperty(globals.Number, "isInteger"))).toBe(true);
  });

  it("treats sandbox coercion helpers as opaque Object sources", async () => {
    const globals = createObjectArrayGlobals({
      budget: new Budget()
    });

    expect(getClosure(getProperty(globals.Object, "keys")).call([globals.String])).toEqual([]);
    expect(getClosure(getProperty(globals.Object, "values")).call([globals.String])).toEqual([]);
    expect(getClosure(getProperty(globals.Object, "entries")).call([globals.String])).toEqual([]);
    expect(
      getClosure(getProperty(globals.Object, "assign")).call([
        {},
        globals.String,
        {
          value: true
        }
      ])
    ).toEqual({
      value: true
    });
  });
});

function getProperty(value: SandboxObject, name: string) {
  return value[name];
}

function getClosureProperty(value: SandboxClosure, name: string) {
  return value.properties?.[name];
}

function getClosure(value: unknown): SandboxClosure {
  return value as SandboxClosure;
}

function createIndexMapper(): SandboxClosure {
  return createSandboxClosure({
    call: ([_value, index]) => index,
    name: "indexMapper"
  });
}
