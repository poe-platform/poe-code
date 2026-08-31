import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { callStringMethod } from "./string.js";

describe("independent String#isWellFormed verification", () => {
  it("classifies every individual UTF-16 code unit", () => {
    const budget = new Budget();
    const native = Reflect.get(String.prototype, "isWellFormed");
    const mismatches: number[] = [];

    for (let codeUnit = 0; codeUnit <= 0xffff; codeUnit++) {
      const value = String.fromCharCode(codeUnit);
      const expected = codeUnit < 0xd800 || codeUnit > 0xdfff;
      if (
        callStringMethod(value, "isWellFormed", [], budget) !== expected ||
        (typeof native === "function" && Reflect.apply(native, value, []) !== expected)
      ) {
        mismatches.push(codeUnit);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it("checks all boundary-alphabet strings through four code units", () => {
    const alphabet = [0, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xffff].map((codeUnit) =>
      String.fromCharCode(codeUnit)
    );
    const budget = new Budget();
    const native = Reflect.get(String.prototype, "isWellFormed");
    const mismatches: string[] = [];
    let values = [""];
    let checked = 0;

    for (let length = 0; length <= 4; length++) {
      for (const value of values) {
        const expected = Array.from(value).every((character) => {
          const codePoint = character.codePointAt(0)!;
          return codePoint < 0xd800 || codePoint > 0xdfff;
        });
        if (
          callStringMethod(value, "isWellFormed", [], budget) !== expected ||
          (typeof native === "function" && Reflect.apply(native, value, []) !== expected)
        ) {
          mismatches.push(value);
        }
        checked++;
      }
      if (length < 4) {
        values = values.flatMap((prefix) => alphabet.map((suffix) => prefix + suffix));
      }
    }

    expect(checked).toBe(4681);
    expect(mismatches).toEqual([]);
  });

  it("handles sliced surrogate pairs without repairing or normalizing the input", async () => {
    await expect(
      run(
        `
          const pair = String.fromCodePoint(128512);
          const high = pair.slice(0, 1);
          const low = pair.slice(1);
          const text = "e\\u0301";
          return [pair.isWellFormed(), high.isWellFormed(), low.isWellFormed(),
            (high + low).isWellFormed(), (low + high).isWellFormed(),
            text.isWellFormed(), text.length];
        `,
        { modules: {} }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [true, false, false, true, false, true, 2]
    });
  });

  it.each([
    ["plain", "\ud800", true],
    ["\ud800", "plain", false]
  ] as const)(
    "retains the extracted receiver %j like neighboring methods",
    async (value, other, expected) => {
      await expect(
        run(
          `
          const check = value.isWellFormed;
          const holder = { check };
          const bound = check.bind(other, 42);
          return [check(), check.call(other), check.apply(other, []), bound(),
            holder.check(), check.length, bound.length,
            value.charCodeAt.call(other, 0) === value.charCodeAt(0)];
        `,
          { modules: {}, bindings: { value, other } }
        )
      ).resolves.toMatchObject({
        ok: true,
        returnValue: [expected, expected, expected, expected, expected, 0, 0, true]
      });
    }
  );

  it("propagates exceptions from evaluated but ignored arguments", async () => {
    await expect(
      run(
        `
          function fail() { throw new Error("argument evaluated"); }
          try { "text".isWellFormed(fail()); }
          catch (error) { return error.message; }
        `,
        { modules: {} }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: "argument evaluated" });
  });

  it("does not allocate output data or charge intrinsic steps like neighboring predicates", () => {
    const budget = new Budget({ maxSteps: 0, stringLength: 0, arrayLength: 0, dataSize: 0 });
    const value = "\ud83d\ude00".repeat(16384);

    expect(callStringMethod(value, "isWellFormed", [], budget)).toBe(true);
    expect(callStringMethod(value, "includes", ["\ud83d\ude00"], budget)).toBe(true);
    expect(budget.stepsUsed).toBe(0);
    expect(budget.peakDataSize).toBe(0);
  });

  it.each([
    [{ maxSteps: 0 }, "steps"],
    [{ maxCallDepth: 0 }, "callDepth"],
    [{ stringLength: 2 }, "stringLength"],
    [{ dataSize: 0 }, "dataSize"]
  ] as const)("enforces public execution limits %j", async (limits, exceeded) => {
    for (const method of ["isWellFormed", "includes"]) {
      await expect(
        run(`return "abc".${method}();`, { modules: {}, budget: new Budget(limits) })
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: exceeded });
    }
  });

  it("enforces sampled deadlines during repeated calls like neighboring predicates", async () => {
    for (const method of ["isWellFormed", "includes"]) {
      await expect(
        run(`while (true) { "abc".${method}(); }`, {
          modules: {},
          budget: new Budget({ deadline: 1, maxSteps: 10000 })
        })
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: "deadline" });
    }
  });

  it("matches the README example alongside the toWellFormed companion", async () => {
    await expect(
      run(
        String.raw`return ["hello".isWellFormed(), "\uD83D\uDE00".isWellFormed(), "\uD800".isWellFormed()];`,
        { modules: {} }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: [true, true, false] });
    await expect(run('return typeof "".toWellFormed;', { modules: {} })).resolves.toMatchObject({
      ok: true,
      returnValue: "function"
    });
  });
});
