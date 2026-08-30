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
    expect(Object.getPrototypeOf(protoEntryObject)).toBeNull();

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

  it("exposes Object.hasOwn with host coercion behavior", async () => {
    const globals = createObjectArrayGlobals({
      budget: new Budget()
    });
    const hasOwn = getClosure(getProperty(globals.Object, "hasOwn"));
    const inherited = Object.create({ inherited: true }) as Record<string, unknown>;
    inherited.own = true;

    expect(await hasOwn.call([inherited, "own"])).toBe(true);
    expect(await hasOwn.call([inherited, "inherited"])).toBe(false);
    expect(await hasOwn.call(["abc", 1])).toBe(true);
    expect(await hasOwn.call([{ __proto__: null }, "__proto__"])).toBe(false);
    expect(await hasOwn.call([{ value: undefined }, "value"])).toBe(true);
    expect(await hasOwn.call([{}, undefined])).toBe(false);
    expect(() => hasOwn.call([null, "value"])).toThrow(TypeError);
    expect(() => hasOwn.call([undefined, "value"])).toThrow(TypeError);
  });

  it("exposes Object.is with SameValue semantics", async () => {
    const globals = createObjectArrayGlobals({
      budget: new Budget()
    });
    const is = getClosure(getProperty(globals.Object, "is"));
    const objectValue = {};
    const arrayValue: unknown[] = [];

    expect(await is.call([NaN, NaN])).toBe(true);
    expect(await is.call([0, -0])).toBe(false);
    expect(await is.call([-0, -0])).toBe(true);
    expect(await is.call([objectValue, objectValue])).toBe(true);
    expect(await is.call([objectValue, {}])).toBe(false);
    expect(await is.call([arrayValue, arrayValue])).toBe(true);
    expect(await is.call([arrayValue, []])).toBe(false);
    expect(await is.call(["value", "value"])).toBe(true);
    expect(await is.call([1, 1])).toBe(true);
    expect(await is.call([true, false])).toBe(false);
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

  it("exposes budgeted String character factories", async () => {
    const globals = createObjectArrayGlobals({
      budget: new Budget()
    });
    const fromCharCode = getClosure(getClosureProperty(globals.String, "fromCharCode"));
    const fromCodePoint = getClosure(getClosureProperty(globals.String, "fromCodePoint"));

    expect(await fromCharCode.call([65, 66, 67])).toBe("ABC");
    expect(await fromCharCode.call([65, "66"])).toBe("AB");
    expect(await fromCharCode.call([])).toBe("");
    expect(await fromCharCode.call([0x1_0041, -1, NaN])).toBe(`A${"\uffff\u0000"}`);
    expect(await fromCodePoint.call([0x1f642])).toBe("🙂");
    expect(await fromCodePoint.call([65, "66"])).toBe("AB");
    expect(await fromCodePoint.call([])).toBe("");
    expect(() => fromCodePoint.call([-1])).toThrow(RangeError);
    expect(() => fromCodePoint.call([1.5])).toThrow(RangeError);
    expect(() => fromCodePoint.call([0x11_0000])).toThrow(RangeError);

    const budgetedGlobals = createObjectArrayGlobals({
      budget: new Budget({
        stringLength: 1
      })
    });

    expect(() =>
      getClosure(getClosureProperty(budgetedGlobals.String, "fromCodePoint")).call([0x1f642])
    ).toThrowError(
      expect.objectContaining({
        budget: "stringLength",
        current: 2,
        limit: 1
      } satisfies Partial<SandboxError>)
    );
    expect(() =>
      getClosure(getClosureProperty(budgetedGlobals.String, "fromCharCode")).call([65, 66])
    ).toThrowError(
      expect.objectContaining({
        budget: "stringLength",
        current: 2,
        limit: 1
      } satisfies Partial<SandboxError>)
    );
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

  it("constructs sparse arrays through the Array constructor", async () => {
    await expect(
      run('const values = Array(1); return [values.length, Object.hasOwn(values, "0"), values[0]];')
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, false, undefined]
    });
    await expect(
      run(
        'const values = new Array(1); return [values.length, Object.hasOwn(values, "0"), values[0]];'
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [1, false, undefined]
    });
  });

  it("collects sandbox set values with Array.from", async () => {
    await expect(
      run("const values = new Set([2147483648, 2147483649]); return Array.from(values);")
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [2147483648, 2147483649]
    });
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

  it("exposes Number parsing, safe integer checks, and constants", async () => {
    const globals = createObjectArrayGlobals({
      budget: new Budget()
    });
    const parseInt = getClosure(getClosureProperty(globals.Number, "parseInt"));
    const parseFloat = getClosure(getClosureProperty(globals.Number, "parseFloat"));
    const isSafeInteger = getClosure(getClosureProperty(globals.Number, "isSafeInteger"));

    expect(await parseInt.call(["11", 2])).toBe(3);
    expect(await parseInt.call([15.9, 10])).toBe(15);
    expect(await parseInt.call(["0x10"])).toBe(16);
    expect(await parseInt.call(["11", "2"])).toBe(3);
    expect(await parseInt.call(["0x10", 10])).toBe(0);
    expect(await parseInt.call(["z", 36])).toBe(35);
    expect(await parseInt.call(["10", 1])).toBeNaN();
    expect(await parseInt.call([])).toBeNaN();
    expect(await parseFloat.call(["3.14more"])).toBe(3.14);
    expect(await parseFloat.call([15.9])).toBe(15.9);
    expect(await parseFloat.call(["  -Infinitytail"])).toBe(-Infinity);
    expect(await parseFloat.call(["not a number"])).toBeNaN();
    expect(await parseFloat.call([])).toBeNaN();
    expect(await isSafeInteger.call([Number.MAX_SAFE_INTEGER])).toBe(true);
    expect(await isSafeInteger.call([Number.MIN_SAFE_INTEGER])).toBe(true);
    expect(await isSafeInteger.call([Number.MAX_SAFE_INTEGER + 1])).toBe(false);
    expect(await isSafeInteger.call([1.5])).toBe(false);
    expect(await isSafeInteger.call([Infinity])).toBe(false);
    expect(await isSafeInteger.call(["1"])).toBe(false);

    expect(getClosureProperty(globals.Number, "MAX_SAFE_INTEGER")).toBe(Number.MAX_SAFE_INTEGER);
    expect(getClosureProperty(globals.Number, "MIN_SAFE_INTEGER")).toBe(Number.MIN_SAFE_INTEGER);
    expect(getClosureProperty(globals.Number, "EPSILON")).toBe(Number.EPSILON);
    expect(getClosureProperty(globals.Number, "MAX_VALUE")).toBe(Number.MAX_VALUE);
    expect(getClosureProperty(globals.Number, "MIN_VALUE")).toBe(Number.MIN_VALUE);
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

function getProperty(value: SandboxObject | SandboxClosure, name: string) {
  if (isSandboxClosure(value)) {
    return value.properties?.[name];
  }

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
