import { describe, expect, it } from "vitest";

import { Budget, SandboxError } from "../budget.js";
import type { SandboxClosure, SandboxObject } from "../values.js";
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

    expect(await getClosure(getProperty(globals.Object, "keys")).call([objectValue])).toEqual(["alpha", "beta"]);
    expect(await getClosure(getProperty(globals.Object, "values")).call([objectValue])).toEqual([1, "two"]);
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
    expect(await getClosure(getProperty(globals.Object, "freeze")).call([objectValue])).toBe(objectValue);
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
    expect(await getClosure(getProperty(globals.Array, "from")).call([[1, "two", false]])).toEqual([1, "two", false]);
    expect(await getClosure(getProperty(globals.Array, "of")).call([1, "two", false])).toEqual([1, "two", false]);

    expect(await globals.String.call([123])).toBe("123");
    expect(await globals.Number.call(["42.5"])).toBe(42.5);
    expect(await globals.Boolean.call([0])).toBe(false);
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

    await expect(getClosure(getProperty(globals.Array, "from")).call([["1", "2"], globals.Number])).resolves.toEqual([1, 2]);
    await expect(getClosure(getProperty(globals.Array, "from")).call(["10", globals.Number])).resolves.toEqual([1, 0]);
  });


  it("blocks assign and freeze on host prototype objects", async () => {
    const globals = createObjectArrayGlobals({
      budget: new Budget()
    });

    expect(() =>
      getClosure(getProperty(globals.Object, "assign")).call([
        Object.prototype as unknown as SandboxObject,
        {
          polluted: true
        }
      ])
    ).toThrowError("Object.assign(target, ...sources) requires an object or array target.");

    expect(await getClosure(getProperty(globals.Object, "freeze")).call([Object.prototype as unknown as SandboxObject])).toBe(
      Object.prototype
    );
    expect(Object.isFrozen(Object.prototype)).toBe(false);
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

function getClosure(value: unknown): SandboxClosure {
  return value as SandboxClosure;
}
