import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";
import { Budget } from "../budget.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { parseRegex } from "../regex/parse.js";
import { matchRegex } from "../regex/engine.js";

describe("Unicode RegExp sets", () => {
  it("counts empty string alternatives toward the matcher ceiling", async () => {
    await expect(run("try{return new RegExp('[\\\\q{'+'|'.repeat(2100)+'}]','v').test('a')}catch(error){return 'caught'}"))
      .rejects.toMatchObject({ code: "budgetExceeded" });
  });

  // Node 22's single-character q alternatives miss uppercase input under /iv.
  // CompileToCharSet explicitly applies MaybeSimpleCaseFolding to these operands.
  it.each([false, true])("folds single-character string operands, negated=%s", async negated => {
    const pattern = `[${negated ? "^" : ""}\\q{a|b}]`;
    const expected = new RegExp(negated ? "[^ab]" : "[ab]", "iv").test("A");
    expect(await run(`return new RegExp(${JSON.stringify(pattern)},'iv').test('A')`))
      .toMatchObject({ ok: true, returnValue: expected });
  });
  it("preserves string-set captures and iterator positions through replay", async () => {
    const source = "const iterator='ab👨‍👩‍👧‍👦'.matchAll(/(?<x>[\\q{ab}\\p{RGI_Emoji}])/dgv);const first=iterator.next().value;await 0;return [first.groups.x,first.indices,iterator.next().value.indices,iterator.next().done];";
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      const expected = await runInNewContext("(async function(){'use strict';" + source + "})()");
      expect(await completed).toMatchObject({ ok: true, returnValue: expected });
      expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: expected });
    } finally { await completed; }
  });

  it("keeps nested-set compilation and string matching bounded", async () => {
    await expect(run("try{return new RegExp('['.repeat(65)+'a'+']'.repeat(65),'v').test('a')}catch(error){return 'caught'}"))
      .rejects.toMatchObject({ code: "budgetExceeded" });
    await expect(run("try{return /^[\\q{a|aa}]+b/v.test('a'.repeat(20))}catch(error){return 'caught'}"))
      .rejects.toMatchObject({ code: "budgetExceeded" });
    await expect(run("return /[\\q{abc|def}]/v.test('abc')", { budget: new Budget({ maxSteps: 10 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded" });
    expect(await run("return /^[\\q{a|aa}]+b/v.test('aab')")).toMatchObject({ ok: true, returnValue: true });
  });

  it("rejects mutually exclusive Unicode flags", async () => {
    expect(await run("try{new RegExp('a','uv')}catch(error){return error.name}"))
      .toMatchObject({ ok: true, returnValue: "SyntaxError" });
  });

  it.each([
    "[]", "[^]", "[[a-z]&&[^aeiou]]", "[[a-z]--[k]]", "[[a-z]--[k]--[s]]",
    "[\\q{ab|a|😀}&&[\\q{ab|😀}]]", "[\\q{ab|a}--[a]]", "[^[[^a]&&[^b]]]",
    "[^[\\q{ab}]&&[a]]", "[^[a]--\\q{ab}]",
    "[\\&\\!\\-]", "[a&b]", "[\\p{ASCII}&&\\P{Lowercase_Letter}]", "[\\q{}]"
  ])("matches the native set matrix: %s", pattern => {
    for (const flags of ["v", "iv"]) {
      const native = new RegExp(pattern, flags);
      const parsed = parseRegex(pattern, flags);
      for (const input of ["", "a", "ab", "A", "K", "ſ", "😀", "&", "!", "k", "S", "β", "\n"]) {
        const expected = native.exec(input);
        const actual = matchRegex(parsed, input);
        expect(actual === null ? null : [actual.index, actual.text], `${pattern}/${flags} on ${input}`)
          .toEqual(expected === null ? null : [expected.index, expected[0]]);
      }
    }
  });
  it.each([
    "return /[[a-z]&&[^aeiou]]+/dv.exec('abcde');",
    "return /[[a-z]--[aeiou]]+/dv.exec('abcde');",
    "return /[[a-c][x-z]]+/dv.exec('abxyz');",
    "return /[\\p{ASCII}&&\\p{Letter}]+/dv.exec('αAb2');",
    "return /[\\p{Letter}--\\p{ASCII}]+/dv.exec('Abαβ');",
    "return /[\\q{ab|cd}]/dv.exec('abcd');",
    "return /[\\q{a+}]/dv.exec('a+');",
    "return /[\\q{a|ab}]b/dv.exec('ab');",
    "return /[\\q{a|abc}]b/dv.exec('abcb');",
    "return /[\\q{ab|abc}]/dv.exec('abc');",
    "return /[\\q{ab|ac}&&\\q{ac|ad}]/dv.exec('abac');",
    "return /[\\q{ab|ac}--\\q{ab}]/dv.exec('abac');",
    "return /[\\q{|ab}]/dv.exec('x');",
    "return /[\\q{😀|😀x}]/dv.exec('😀x');",
    "return /(?<=([\\q{ab|abc}]))x/dv.exec('abcx');",
    "return /\\p{RGI_Emoji}/dv.exec('👨‍👩‍👧‍👦');",
    "return /[\\p{RGI_Emoji}--\\q{😀}]/dv.exec('😀😁');",
    "return /\\p{Basic_Emoji}\uFE0F/dv.exec('☀️');",
    "return /(?<=(\\p{RGI_Emoji}))x/dv.exec('👨‍👩‍👧‍👦x');",
    "return [/\\P{Lowercase_Letter}/iv.test('a'),/[^\\p{Lowercase_Letter}]/iv.test('a')];",
    "return /[[a-z]--[k]]+/iv.exec('Kſ');",
    "return /[\\q{Ab|Cd}]/iv.exec('aB');",
    "return '😀x'.split(/(?:)/v);",
    "return '😀'.replace(/(?:)/gv,'-');",
    "return Array.from('😀x'.matchAll(/./dgv),match=>match.indices);",
    "return [/./v.unicode,/./v.unicodeSets,/./v.flags];"
  ])("matches native: %s", async source => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    "[a-z&&b]", "[ab&&c]", "[a&&b--c]", "[a--]", "[&&a]", "[a&&]",
    "[a-b-c]", "[()]", "[{}]", "[|]", "[a!!b]", "[^\\q{ab}]",
    "[^\\p{RGI_Emoji}]", "\\P{RGI_Emoji}", "[\\q{\\d}]"
  ])("rejects invalid set syntax: %s", async pattern => {
    expect(() => new RegExp(pattern, "v")).toThrow(SyntaxError);
    expect(await run(`try{new RegExp(${JSON.stringify(pattern)},'v')}catch(error){return error.name}`))
      .toMatchObject({ ok: true, returnValue: "SyntaxError" });
  });
});
