import { describe, expect, it, vi } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { type SandboxArray, type SandboxValue } from "../values.js";
import { callArrayMethod, type ArrayMethodOptions } from "./array.js";

function createOptions(budget = new Budget()): ArrayMethodOptions {
  return {
    budget,
    callClosure: async () => {
      throw new Error("with must not invoke a callback");
    }
  };
}

describe("bounded Array.prototype.with", () => {
  it.each<[SandboxValue, number]>([
    [0, 0],
    [2, 2],
    [-1, 2],
    [-3, 0],
    [1.9, 1],
    [-1.9, 2],
    [-0.9, 0],
    [-0, 0],
    [undefined, 0],
    [null, 0],
    [Number.NaN, 0],
    [false, 0],
    [true, 1],
    ["", 0],
    [" 1.9 ", 1],
    ["-1.9", 2],
    ["not a number", 0]
  ])("coerces index %j to position %i", async (index, position) => {
    const source = [10, 20, 30];
    const expected = [10, 20, 30];
    expected[position] = 99;

    const result = await callArrayMethod(source, "with", [index, 99], createOptions());

    expect(result).toStrictEqual(expected);
    expect(result).not.toBe(source);
    expect(source).toStrictEqual([10, 20, 30]);
  });

  it.each<SandboxValue>([3, -4, Infinity, -Infinity, "Infinity", "-Infinity"])(
    "rejects out-of-range index %j without mutation",
    async (index) => {
      const source = [10, 20, 30];
      await expect(callArrayMethod(source, "with", [index, 99], createOptions())).rejects.toThrow(
        RangeError
      );
      expect(source).toStrictEqual([10, 20, 30]);
    }
  );

  it("rejects an empty receiver and defaults missing arguments to undefined", async () => {
    await expect(callArrayMethod([], "with", [], createOptions())).rejects.toThrow(RangeError);
    await expect(callArrayMethod([1, 2], "with", [], createOptions())).resolves.toStrictEqual([
      undefined,
      2
    ]);
    await expect(callArrayMethod([1, 2], "with", [1], createOptions())).resolves.toStrictEqual([
      1,
      undefined
    ]);
  });

  it("copies shallow references from a frozen source without copying metadata", async () => {
    const retained = { nested: 1 };
    const replacement = { nested: 2 };
    const source: SandboxArray = [retained, 3];
    Object.assign(source, { extra: "metadata" });
    Object.freeze(source);

    const result = (await callArrayMethod(
      source,
      "with",
      [1, replacement],
      createOptions()
    )) as SandboxArray;

    expect(result).not.toBe(source);
    expect(result[0]).toBe(retained);
    expect(result[1]).toBe(replacement);
    expect(Object.hasOwn(result, "extra")).toBe(false);
    result[0] = 4;
    expect(source[0]).toBe(retained);
    expect(source[1]).toBe(3);
  });

  it("densifies holes without modifying the sparse source", async () => {
    const source = new Array(4) as SandboxArray;
    source[1] = 2;
    const result = await callArrayMethod(source, "with", [-1, 9], createOptions());

    expect(result).toStrictEqual([undefined, 2, undefined, 9]);
    expect(Object.keys(result as SandboxArray)).toStrictEqual(["0", "1", "2", "3"]);
    expect(Object.keys(source)).toStrictEqual(["1"]);
  });

  it("does not read the replaced source slot", async () => {
    const source = [1, 2, 3];
    const read = vi.fn(() => {
      throw new Error("replaced slot must not be read");
    });
    Object.defineProperty(source, "1", { get: read });

    await expect(callArrayMethod(source, "with", [1, 9], createOptions())).resolves.toStrictEqual([
      1, 9, 3
    ]);
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects invalid indices before reading or checking the copy budget", async () => {
    const source = [1, 2];
    const read = vi.fn(() => 1);
    Object.defineProperty(source, "0", { get: read });

    await expect(
      callArrayMethod(source, "with", [2, 9], createOptions(new Budget({ arrayLength: 0 })))
    ).rejects.toThrow(RangeError);
    expect(read).not.toHaveBeenCalled();
  });

  it("preflights the array-length budget before reading source entries", async () => {
    const source = [1, 2, 3];
    const read = vi.fn(() => 1);
    Object.defineProperty(source, "0", { get: read });

    await expect(
      callArrayMethod(source, "with", [1, 9], createOptions(new Budget({ arrayLength: 2 })))
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
    expect(read).not.toHaveBeenCalled();
  });

  it("does not dispatch to a receiver's host iterator", async () => {
    const source = [1, 2, 3];
    const iterate = vi.fn(() => {
      throw new Error("host iterator must not run");
    });
    Object.defineProperty(source, Symbol.iterator, { value: iterate });

    await expect(callArrayMethod(source, "with", [1, 9], createOptions())).resolves.toStrictEqual([
      1, 9, 3
    ]);
    expect(iterate).not.toHaveBeenCalled();
  });

  it("treats inherited host entries as holes", async () => {
    const source = new Array(3) as SandboxArray;
    source[2] = 3;
    const read = vi.fn(() => "host value");
    const prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, "0", { get: read });
    Object.setPrototypeOf(source, prototype);

    await expect(callArrayMethod(source, "with", [1, 9], createOptions())).resolves.toStrictEqual([
      undefined,
      9,
      3
    ]);
    expect(read).not.toHaveBeenCalled();
  });

  it("admits the exact array-length and copy-step budgets", async () => {
    const budget = new Budget({ arrayLength: 3, maxSteps: 3 });
    await expect(
      callArrayMethod([1, 2, 3], "with", [1, 9], createOptions(budget))
    ).resolves.toStrictEqual([1, 9, 3]);
    expect(budget.stepsUsed).toBe(3);
  });

  it.each([0, 1, 2])("stops copying when the step budget is %i", async (maxSteps) => {
    const source = [1, 2, 3];
    await expect(
      callArrayMethod(source, "with", [1, 9], createOptions(new Budget({ maxSteps })))
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    expect(source).toStrictEqual([1, 2, 3]);
  });

  it("honors a scheduled deadline check before reading source entries", async () => {
    const source = [1, 2, 3];
    const read = vi.fn(() => 1);
    Object.defineProperty(source, "0", { get: read });
    const budget = new Budget({ deadline: 1 });
    for (let step = 0; step < 1_023; step += 1) {
      budget.visitNode();
    }

    await expect(
      callArrayMethod(source, "with", [1, 9], createOptions(budget))
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "deadline" });
    expect(read).not.toHaveBeenCalled();
  });

  it("retains produced-value validation for replacement values", async () => {
    await expect(
      callArrayMethod([1], "with", [0, "long"], createOptions(new Budget({ stringLength: 3 })))
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
  });
});

describe("Array.prototype.with interpreter integration", () => {
  it("evaluates extra arguments left-to-right before copying but ignores their values", async () => {
    await expect(
      run(
        `
        const source = [1, 2, 3];
        const events = [];
        function argument(label, value) { events.push(label); return value; }
        function extra() { events.push("extra"); source.push(4); return 100; }
        const result = source.with(argument("index", -1), argument("value", 9), extra());
        return { source, result, events, distinct: source !== result };
      `,
        { modules: {} }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: {
        source: [1, 2, 3, 4],
        result: [1, 2, 3, 9],
        events: ["index", "value", "extra"],
        distinct: true
      }
    });
  });

  it("propagates an ignored argument's error before range validation", async () => {
    await expect(
      run(
        `
        function fail() { throw new Error("extra evaluated"); }
        try { [].with(0, 9, fail()); }
        catch (error) { return error.message; }
      `,
        { modules: {} }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: "extra evaluated" });
  });

  it("exposes a catchable RangeError in the interpreter", async () => {
    await expect(
      run(
        `
        try { [1, 2].with(-3, 9); }
        catch (error) { return [error.name, error instanceof RangeError]; }
      `,
        { modules: {} }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: ["RangeError", true] });
  });

  it("densifies interpreter holes and preserves nested reference identity", async () => {
    await expect(
      run(
        `
        const nested = { value: 1 };
        const source = [, nested, ,];
        const replacement = { value: 2 };
        const result = source.with(-1, replacement);
        return [Object.keys(source), Object.keys(result), result[0] === undefined,
          result[1] === nested, result[2] === replacement, source !== result];
      `,
        { modules: {} }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [["1"], ["0", "1", "2"], true, true, true, true]
    });
  });
});
