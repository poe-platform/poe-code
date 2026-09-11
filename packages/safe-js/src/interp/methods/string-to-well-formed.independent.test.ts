import { describe, expect, it, vi } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { callStringMethod } from "./string.js";

describe("independent String#toWellFormed verification", () => {
  it("repairs every individual UTF-16 code unit", () => {
    const budget = new Budget();
    const native = Reflect.get(String.prototype, "toWellFormed");
    const mismatches: number[] = [];

    for (let codeUnit = 0; codeUnit <= 0xffff; codeUnit++) {
      const value = String.fromCharCode(codeUnit);
      const expected = codeUnit >= 0xd800 && codeUnit <= 0xdfff ? "\ufffd" : value;
      if (
        callStringMethod(value, "toWellFormed", [], budget) !== expected ||
        (typeof native === "function" && Reflect.apply(native, value, []) !== expected)
      ) {
        mismatches.push(codeUnit);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it("repairs all boundary-alphabet strings through four code units", () => {
    const alphabet = [0, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xffff].map((codeUnit) =>
      String.fromCharCode(codeUnit)
    );
    const budget = new Budget();
    const native = Reflect.get(String.prototype, "toWellFormed");
    const mismatches: string[] = [];
    let values = [""];
    let checked = 0;

    for (let length = 0; length <= 4; length++) {
      for (const value of values) {
        const expected = Array.from(value, (character) => {
          const codePoint = character.codePointAt(0)!;
          return codePoint >= 0xd800 && codePoint <= 0xdfff ? "\ufffd" : character;
        }).join("");
        if (
          callStringMethod(value, "toWellFormed", [], budget) !== expected ||
          expected.length !== value.length ||
          callStringMethod(expected, "toWellFormed", [], budget) !== expected ||
          callStringMethod(expected, "isWellFormed", [], budget) !== true ||
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

  it("preserves pairs covering every high and low surrogate beside repairs", () => {
    const budget = new Budget();
    const mismatches: number[] = [];
    for (let offset = 0; offset < 1024; offset++) {
      const pair = String.fromCharCode(0xd800 + offset, 0xdfff - offset);
      const value = "\udfff" + pair + "\ud800";
      if (callStringMethod(value, "toWellFormed", [], budget) !== "\ufffd" + pair + "\ufffd") {
        mismatches.push(offset);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it.each([
    ["plain", "\ud800", "plain"],
    ["\ud800", "plain", "\ufffd"]
  ] as const)(
    "uses explicit receivers and zero arity after extraction from %j",
    async (value, other, expected) => {
      const otherExpected = other === "plain" ? "plain" : "\ufffd";
      await expect(
        run(
          `
          const repair = value.toWellFormed;
          const holder = { repair, toString(){return other} };
          const bound = repair.bind(other, 42);
          let detached;
          try{repair()}catch(error){detached=error.name}
          return [repair.call(value), repair.call(other), repair.apply(other, []), bound(),
            holder.repair(), repair.length, bound.length, value, detached];
        `,
          { modules: {}, bindings: { value, other } }
        )
      ).resolves.toMatchObject({
        ok: true,
        returnValue: [expected, otherExpected, otherExpected, otherExpected, otherExpected, 0, 0, value, "TypeError"]
      });
    }
  );

  it("evaluates spread arguments left to right without coercion or invocation", async () => {
    await expect(
      run(
        String.raw`
          const trace = [];
          function ignored() { throw new Error("called"); }
          const object = { toString() { throw new Error("coerced"); } };
          const value = "\uD800";
          const result = value.toWellFormed(...[trace.push(1), ignored], trace.push(2), object);
          return [result, trace, value.isWellFormed(), result.isWellFormed(), value];
        `,
        { modules: {} }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: ["\ufffd", [1, 2], false, true, "\ud800"]
    });
  });

  it("bounds code-unit scanning and total copied spans by input size", () => {
    const value = "a\ud800b\ud83d\ude00\udfff".repeat(1024);
    const budget = new Budget({ stringLength: value.length, maxSteps: 0, dataSize: 0 });
    const scan = vi.spyOn(String.prototype, "charCodeAt");
    const slice = vi.spyOn(String.prototype, "slice");
    let result: unknown;
    let scanned = 0;
    let copied = 0;
    let slices = 0;
    try {
      result = callStringMethod(value, "toWellFormed", [], budget);
      scanned = scan.mock.calls.length;
      slices = slice.mock.calls.length;
      copied = slice.mock.results.reduce((total, entry) => total + entry.value.length, 0);
    } finally {
      scan.mockRestore();
      slice.mockRestore();
    }

    expect(result).toBe("a\ufffdb\ud83d\ude00\ufffd".repeat(1024));
    expect(scanned).toBeLessThanOrEqual(value.length * 2);
    expect(slices).toBeLessThanOrEqual(value.length + 1);
    expect(copied).toBeLessThanOrEqual(value.length);
    expect(budget.stepsUsed).toBe(0);
    expect(budget.peakDataSize).toBe(0);
  });

  it("matches the README repair example", async () => {
    await expect(
      run(
        String.raw`return ["hello".toWellFormed(), "\uD83D\uDE00".toWellFormed(), "\uD800".toWellFormed()];`,
        { modules: {} }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: ["hello", "\ud83d\ude00", "\ufffd"] });
  });

  it("preflights length before copying or allocating a repaired result", () => {
    const value = "\ud800".repeat(1024);
    const budget = new Budget({ stringLength: value.length - 1 });
    const slice = vi.spyOn(String.prototype, "slice");
    const allocate = vi.spyOn(budget, "allocateString");
    let failure: unknown;
    let slices = 0;
    let allocations = 0;
    try {
      try {
        callStringMethod(value, "toWellFormed", [], budget);
      } catch (error) {
        failure = error;
      }
      slices = slice.mock.calls.length;
      allocations = allocate.mock.calls.length;
    } finally {
      slice.mockRestore();
      allocate.mockRestore();
    }

    expect(failure).toMatchObject({
      code: "budgetExceeded",
      budget: "stringLength",
      current: value.length,
      limit: value.length - 1
    });
    expect(slices).toBe(0);
    expect(allocations).toBe(1);
  });
});
