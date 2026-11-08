import { describe, expect, it, vi } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { isSandboxClosure } from "../values.js";
import { callStringMethod, getStringMember } from "./string.js";

describe("String#toWellFormed", () => {
  it("exposes a zero-arity sandbox closure", async () => {
    expect(isSandboxClosure(getStringMember("", "toWellFormed", new Budget()))).toBe(true);
    await expect(
      run('return [typeof "".toWellFormed, "".toWellFormed.length];', { modules: {} })
    ).resolves.toMatchObject({ ok: true, returnValue: ["function", 0] });
  });

  it.each([
    ["empty", "", ""],
    ["ASCII", "hello", "hello"],
    ["NUL", "\u0000", "\u0000"],
    ["combining marks", "e\u0301", "e\u0301"],
    ["BMP boundaries", "\ud7ff\ue000\uffff", "\ud7ff\ue000\uffff"],
    ["replacement character", "\ufffd", "\ufffd"],
    ["first surrogate pair", "\ud800\udc00", "\ud800\udc00"],
    ["last surrogate pair", "\udbff\udfff", "\udbff\udfff"],
    ["emoji", "\ud83d\ude00", "\ud83d\ude00"],
    ["consecutive pairs", "\ud800\udfff\udbff\udc00", "\ud800\udfff\udbff\udc00"],
    ["mixed valid text", "before\ud83d\ude00after", "before\ud83d\ude00after"],
    ["first lone high surrogate", "\ud800", "\ufffd"],
    ["last lone high surrogate", "\udbff", "\ufffd"],
    ["first lone low surrogate", "\udc00", "\ufffd"],
    ["last lone low surrogate", "\udfff", "\ufffd"],
    ["reversed pair", "\udc00\ud800", "\ufffd\ufffd"],
    ["two high surrogates", "\ud800\udbff", "\ufffd\ufffd"],
    ["two low surrogates", "\udc00\udfff", "\ufffd\ufffd"],
    ["interrupted pair", "\ud800x\udc00", "\ufffdx\ufffd"],
    ["trailing high surrogate", "text\ud800", "text\ufffd"],
    ["low surrogate after a pair", "\ud83d\ude00\udfff", "\ud83d\ude00\ufffd"],
    ["high surrogate before a pair", "\ud800\ud83d\ude00", "\ufffd\ud83d\ude00"],
    ["pair between lone surrogates", "\udfff\ud800\udc00\udbff", "\ufffd\ud800\udc00\ufffd"],
    ["separated repairs", "a\ud800bc\udfffdef", "a\ufffdbc\ufffddef"]
  ] as const)("repairs %s without changing UTF-16 length", async (_label, value, expected) => {
    const budget = new Budget();
    const result = callStringMethod(value, "toWellFormed", [], budget);
    expect(result).toBe(expected);
    expect(expected.length).toBe(value.length);
    expect(callStringMethod(expected, "toWellFormed", [], budget)).toBe(expected);
    expect(callStringMethod(expected, "isWellFormed", [], budget)).toBe(true);
    await expect(
      run(`return ${JSON.stringify(value)}.toWellFormed();`, { modules: {} })
    ).resolves.toMatchObject({ ok: true, returnValue: expected });

    const native = Reflect.get(String.prototype, "toWellFormed");
    if (typeof native === "function") {
      expect(Reflect.apply(native, value, [])).toBe(expected);
    }
  });

  it("supports computed calls, dynamic strings, and composition", async () => {
    await expect(
      run(
        `
          function repair(value) { return value["toWellFormed"](); }
          const value = String.fromCharCode(55296) + String.fromCodePoint(128512);
          const repaired = repair(value);
          return [repaired, repaired.isWellFormed(), repaired.toWellFormed() === repaired];
        `,
        { modules: {} }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: ["\ufffd\ud83d\ude00", true, true] });
  });

  it("evaluates extra arguments without calling or coercing them", async () => {
    await expect(
      run(
        String.raw`
          const trace = [];
          function ignored() { trace.push("called"); }
          const value = { toString() { trace.push("coerced"); return "ignored"; } };
          const result = "\uD800".toWellFormed(trace.push("evaluated"), ignored, value);
          return [result, trace];
        `,
        { modules: {} }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: ["\ufffd", ["evaluated"]] });
  });

  it("propagates exceptions from evaluated extra arguments", async () => {
    await expect(
      run(
        `
          function fail() { throw new Error("argument evaluated"); }
          try { "text".toWellFormed(fail()); }
          catch (error) { return error.message; }
        `,
        { modules: {} }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: "argument evaluated" });
  });

  it.each(["", "abc", "\ud800", "\ud83d\ude00", "a\ud800b\udfff"])(
    "admits the exact string length without intrinsic step or data charges for %j",
    (value) => {
      const budget = new Budget({
        stringLength: value.length,
        maxSteps: 0,
        arrayLength: 0,
        dataSize: 0
      });
      expect(callStringMethod(value, "toWellFormed", [], budget)).toHaveLength(value.length);
      expect(budget.stepsUsed).toBe(0);
      expect(budget.peakDataSize).toBe(0);
    }
  );

  it.each(["abc", "\ud800", "\ud83d\ude00", "a\ud800b\udfff"])(
    "rejects an oversized result before scanning %j",
    (value) => {
      const budget = new Budget({ stringLength: value.length - 1 });
      const scan = vi.spyOn(String.prototype, "charCodeAt");
      let failure: unknown;
      try {
        try {
          callStringMethod(value, "toWellFormed", [], budget);
        } catch (error) {
          failure = error;
        }
        expect(scan).not.toHaveBeenCalled();
      } finally {
        scan.mockRestore();
      }
      expect(failure).toMatchObject({
        code: "budgetExceeded",
        budget: "stringLength",
        current: value.length,
        limit: value.length - 1
      });
    }
  );

  it("uses the existing string allocator for preflight and the repaired result", () => {
    const budget = new Budget({ stringLength: 3 });
    const allocate = vi.spyOn(budget, "allocateString");
    expect(callStringMethod("a\ud800b", "toWellFormed", [], budget)).toBe("a\ufffdb");
    expect(allocate.mock.calls).toEqual([["a\ud800b"], ["a\ufffdb"]]);
  });

  it("repairs a longer mixed string without expanding it", () => {
    const value = "a\ud800b\ud83d\ude00\udfff".repeat(2048);
    expect(
      callStringMethod(value, "toWellFormed", [], new Budget({ stringLength: value.length }))
    ).toBe("a\ufffdb\ud83d\ude00\ufffd".repeat(2048));
  });

  it.each([
    [{ maxSteps: 0 }, "steps"],
    [{ maxCallDepth: 0 }, "callDepth"],
    [{ stringLength: 2 }, "stringLength"],
    [{ dataSize: 0 }, "dataSize"]
  ] as const)("retains public execution limits %j", async (limits, exceeded) => {
    await expect(
      run('return "abc".toWellFormed();', { modules: {}, budget: new Budget(limits) })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: exceeded });
  });

  it("retains sampled deadline checks during repeated calls", async () => {
    await expect(
      run('while (true) { "abc".toWellFormed(); }', {
        modules: {},
        budget: new Budget({ deadline: 1, maxSteps: 10000 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "deadline" });
  });
});
