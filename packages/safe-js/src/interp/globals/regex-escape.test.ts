import { describe, expect, it } from "vitest";
import { run } from "../../core.js";
import { Budget } from "../budget.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { createRegexGlobals } from "./regex.js";
import { materializeFunctionProperties } from "../object-model.js";
import { isSandboxClosure } from "../values.js";

describe("RegExp.escape", () => {
  it("preserves escaped output and method access through checkpoint replay", async () => {
    const source = "const escaped=RegExp.escape('a-b');await 0;return [escaped,RegExp.escape('1'),new RegExp(escaped,'v').test('a-b')];";
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      const expected = { ok: true, returnValue: ["\\x61\\x2db", "\\x31", true] };
      expect(await completed).toMatchObject(expected);
      expect(await run(source, { snapshot })).toMatchObject(expected);
    } finally { await completed; }
  });

  it.each(["steps", "stringLength", "dataSize"])("bounds escaping by %s and releases temporary data", async kind => {
    const budget = new Budget(kind === "steps" ? { maxSteps: 2 } : kind === "stringLength" ? { stringLength: 7 } : { dataSize: 7 });
    const globals = createRegexGlobals({ budget });
    const method = materializeFunctionProperties(globals.RegExp).escape;
    if (!isSandboxClosure(method)) throw new Error("Missing escape method");
    const initial = budget.currentDataSize;
    expect(() => method.call(["---"])).toThrowError(expect.objectContaining({ code: "budgetExceeded", budget: kind }));
    expect(budget.currentDataSize).toBe(initial);
    if (kind !== "steps") expect(method.call(["-"])).toBe("\\x2d");
    await expect(run("try{return RegExp.escape('----')}catch(error){return 'caught'}", { budget: new Budget({ stringLength: 7 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded" });
  });

  it("supports ordinary method replacement and deletion", async () => {
    expect(await run("const original=RegExp.escape;RegExp.escape=()=> 'custom';const changed=RegExp.escape('a');delete RegExp.escape;return [changed,typeof RegExp.escape,original('a')];"))
      .toMatchObject({ ok: true, returnValue: ["custom", "undefined", "\\x61"] });
  });

  // Explicit ECMAScript encodings: the installed Node 22 lacks this API.
  it.each([
    ["", ""], ["foo", "\\x66oo"], ["1a", "\\x31a"], ["a-b", "\\x61\\x2db"],
    ["foo.bar", "\\x66oo\\.bar"], ["/^$.*+?()[]{}|\\", "\\/\\^\\$\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\\\"],
    [",-=<>#&!%:;@~'`\"", "\\x2c\\x2d\\x3d\\x3c\\x3e\\x23\\x26\\x21\\x25\\x3a\\x3b\\x40\\x7e\\x27\\x60\\x22"],
    [" \f\n\r\t\v", "\\x20\\f\\n\\r\\t\\v"],
    ["\u00a0\u2028\u2029\ufeff", "\\xa0\\u2028\\u2029\\ufeff"],
    ["\u1680\u2000\u200a\u202f\u205f\u3000", "\\u1680\\u2000\\u200a\\u202f\\u205f\\u3000"],
    ["\u0085\u180e", "\u0085\u180e"], ["\b\0", "\b\0"],
    ["😀", "😀"], ["\ud800", "\\ud800"], ["\udc00", "\\udc00"],
    ["\ud800A\udc00", "\\ud800A\\udc00"], ["é", "é"]
  ])("encodes %j", async (input, expected) => {
    expect(await run(`return RegExp.escape(${JSON.stringify(input)})`))
      .toMatchObject({ ok: true, returnValue: expected });
    for (const flags of ["", "u", "v"]) expect(new RegExp("^(?:" + expected + ")$", flags).test(input)).toBe(true);
  });

  it.each(["undefined", "null", "12", "true", "Symbol('x')", "new String('x')", "({toString(){throw 'coerced'}})"])("rejects non-string input without coercion: %s", async input => {
    expect(await run(`try{RegExp.escape(${input})}catch(error){return error.name}`))
      .toMatchObject({ ok: true, returnValue: "TypeError" });
  });

  it("exposes a mutable, non-enumerable non-constructor method", async () => {
    expect(await run("const fn=RegExp.escape;const d=Object.getOwnPropertyDescriptor(RegExp,'escape');let rejected=false;try{new fn('x')}catch(error){rejected=error.name==='TypeError'}return [fn.name,fn.length,d.writable,d.enumerable,d.configurable,rejected,fn.call(null,'a')];"))
      .toMatchObject({ ok: true, returnValue: ["escape", 1, true, false, true, true, "\\x61"] });
  });

  it("prevents concatenated digits from extending a backreference", async () => {
    expect(await run("const regex=new RegExp('(a)\\\\1'+RegExp.escape('1'));return [regex.test('aa1'),regex.test('a1')];"))
      .toMatchObject({ ok: true, returnValue: [true, false] });
  });
});
