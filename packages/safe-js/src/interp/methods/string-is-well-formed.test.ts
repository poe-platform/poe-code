import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { isSandboxClosure } from "../values.js";
import { callStringMethod, getStringMember } from "./string.js";

describe("String#isWellFormed", () => {
  it("exposes the method as a sandbox closure with zero arity", async () => {
    expect(isSandboxClosure(getStringMember("", "isWellFormed", new Budget()))).toBe(true);
    await expect(
      run('return [typeof "".isWellFormed, "".isWellFormed.length];', { modules: {} })
    ).resolves.toMatchObject({ ok: true, returnValue: ["function", 0] });
  });

  it.each([
    ["empty", "", true],
    ["ASCII", "hello", true],
    ["NUL", "\u0000", true],
    ["combining marks", "e\u0301", true],
    ["BMP boundaries", "\ud7ff\ue000\uffff", true],
    ["replacement character", "\ufffd", true],
    ["first surrogate pair", "\ud800\udc00", true],
    ["last surrogate pair", "\udbff\udfff", true],
    ["emoji", "\ud83d\ude00", true],
    ["consecutive pairs", "\ud800\udfff\udbff\udc00", true],
    ["mixed text", "before\ud83d\ude00after", true],
    ["first lone high surrogate", "\ud800", false],
    ["last lone high surrogate", "\udbff", false],
    ["first lone low surrogate", "\udc00", false],
    ["last lone low surrogate", "\udfff", false],
    ["reversed pair", "\udc00\ud800", false],
    ["two high surrogates", "\ud800\udbff", false],
    ["two low surrogates", "\udc00\udfff", false],
    ["interrupted pair", "\ud800x\udc00", false],
    ["trailing high surrogate", "text\ud800", false],
    ["low surrogate after a pair", "\ud83d\ude00\udfff", false],
    ["high surrogate before a pair", "\ud800\ud83d\ude00", false]
  ] as const)("classifies %s", async (_label, value, expected) => {
    expect(callStringMethod(value, "isWellFormed", [], new Budget())).toBe(expected);
    await expect(
      run(`return ${JSON.stringify(value)}.isWellFormed();`, { modules: {} })
    ).resolves.toMatchObject({ ok: true, returnValue: expected });

    const native = Reflect.get(String.prototype, "isWellFormed");
    if (typeof native === "function") {
      expect(Reflect.apply(native, value, [])).toBe(expected);
    }
  });

  it("supports computed calls and dynamically constructed strings", async () => {
    await expect(
      run(
        `
          function check(value) { return value["isWellFormed"](); }
          return [check(String.fromCodePoint(128512)), check(String.fromCharCode(55296))];
        `,
        { modules: {} }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: [true, false] });
  });

  it("evaluates extra arguments but neither calls nor coerces them", async () => {
    await expect(
      run(
        `
          const trace = [];
          function ignored() { trace.push("called"); }
          const value = { toString() { trace.push("coerced"); return "ignored"; } };
          const result = "hello".isWellFormed(trace.push("evaluated"), ignored, value);
          return [result, trace];
        `,
        { modules: {} }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: [true, ["evaluated"]] });
  });
});
