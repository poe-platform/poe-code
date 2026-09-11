import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";
import { Budget } from "../budget.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

// Node 22 does not implement modifier groups. Use equivalent native patterns
// and explicit scoping controls from ECMAScript CompileSubpattern/UpdateModifiers.
describe("RegExp inline modifiers", () => {
  it("preserves modifier groups through iterator checkpoint replay", async () => {
    const source = "const iterator='Aa'.matchAll(/(?i:(?<x>a))/dg);const first=iterator.next().value;await 0;return [first.groups.x,iterator.next().value.groups.x,iterator.next().done];";
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      expect(await completed).toMatchObject({ ok: true, returnValue: ["A", "a", true] });
      expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: ["A", "a", true] });
    } finally { await completed; }
  });

  it("keeps modifier compilation and nested backtracking bounded", async () => {
    await expect(run("try{return new RegExp('(?i:'.repeat(65)+'a'+')'.repeat(65)).test('a')}catch(error){return 'caught'}"))
      .rejects.toMatchObject({ code: "budgetExceeded" });
    await expect(run("try{return /^(?i:(a+)+)b/.test('A'.repeat(16))}catch(error){return 'caught'}"))
      .rejects.toMatchObject({ code: "budgetExceeded" });
    await expect(run("return /(?ims:a)/.test('A')", { budget: new Budget({ maxSteps: 10 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded" });
    expect(await run("return /^(?i:(a+)+)b/.test('AAb')")).toMatchObject({ ok: true, returnValue: true });
  });

  it.each([
    ["(?i:a)b", "", "Ab", "[aA]b", ""],
    ["(?i:a)b", "", "aB", "[aA]b", ""],
    ["a(?-i:b)", "i", "Ab", "[aA]b", ""],
    ["a(?-i:b)", "i", "AB", "[aA]b", ""],
    ["(?i:a(?-i:b)c)d", "", "AbCd", "[aA]b[cC]d", ""],
    ["(?i:a(?-i:b)c)d", "", "ABCD", "[aA]b[cC]d", ""],
    ["(?i:a|ab)c", "", "ABc", "(?:[aA]|[aA][bB])c", ""],
    ["(?s:a.b)c", "", "a\nbc", "a[\\s\\S]bc", ""],
    ["a(?-s:.)b", "s", "a\nb", "a.b", ""],
    ["(?m:^b$)", "", "a\nb\nc", "^b$", "m"],
    ["(?-m:^b$)", "m", "a\nb\nc", "^b$", ""],
    ["(?ims:^a.b$)", "", "x\nA\nB\nx", "^a.b$", "ims"],
    ["(?i-:a)", "", "A", "a", "i"],
    ["(?-ims:a)", "ims", "A", "a", ""],
    ["(?<=(?i:(a)))b", "d", "Ab", "(?<=([aA]))b", "d"],
    ["(?i:(a)\\1)", "d", "Aa", "(a)\\1", "di"],
    ["(?i:(a))\\1", "d", "Aa", "([aA])\\1", "d"],
    ["(?i:[a-z])", "u", "K", "[a-z]", "iu"],
    ["(?i:[[a-z]--[k]])", "v", "ſ", "[[a-z]--[k]]", "iv"],
    ["(?i:a)+b", "", "AaAb", "[aA]+b", ""]
  ])("matches scoped flags %s /%s", async (pattern, flags, input, equivalent, equivalentFlags) => {
    const expected = new RegExp(equivalent, equivalentFlags).exec(input);
    expect(await run(`return new RegExp(${JSON.stringify(pattern)},${JSON.stringify(flags)}).exec(${JSON.stringify(input)})`))
      .toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["(?-:a)", "(?ii:a)", "(?i-i:a)", "(?i--m:a)", "(?-mm:a)", "(?g:a)", "(?u:a)", "(?v:a)", "(?d:a)", "(?y:a)", "(?x:a)", "(?i)a", "(?i a)"])("rejects invalid modifier group %s", async pattern => {
    expect(await run(`try{new RegExp(${JSON.stringify(pattern)})}catch(error){return error.name}`))
      .toMatchObject({ ok: true, returnValue: "SyntaxError" });
  });

  it("does not mutate public flags or subsequent matching scopes", async () => {
    expect(await run("const regex=/(?i:a)b/;return [regex.flags,regex.ignoreCase,regex.test('Ab'),regex.test('AB')];"))
      .toMatchObject({ ok: true, returnValue: ["", false, true, false] });
  });

  it("preserves replacement capture numbering", async () => {
    const expected = runInNewContext("'Ab'.replace(/([aA])(b)/,'$2$1')");
    expect(await run("return 'Ab'.replace(/(?i:(a))(b)/,'$2$1');"))
      .toMatchObject({ ok: true, returnValue: expected });
  });
});
