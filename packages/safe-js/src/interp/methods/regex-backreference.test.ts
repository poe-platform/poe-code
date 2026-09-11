import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

describe("RegExp numbered backreferences", () => {
  it("charges each captured-character comparison", async () => {
    await expect(run("return /^(a{250})\\1{7}$/.test('a'.repeat(2000));"))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    expect(await run("return /^(a{100})\\1{7}$/.test('a'.repeat(800));"))
      .toMatchObject({ ok: true, returnValue: true });
  });
  it("preserves compiled references across an iterator checkpoint", async () => {
    const source = "const iterator='aabb'.matchAll(/(.)\\1/dg);iterator.next();await 0;const next=iterator.next();return [next.value[0],next.value[1],next.value.indices,iterator.next().done];";
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      const expected = await runInNewContext("(async function(){'use strict';" + source + "})()");
      expect(await completed).toMatchObject({ ok: true, returnValue: expected });
      expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: expected });
    } finally { await completed; }
  });
  it("charges compilation work for resolving numeric escapes", async () => {
    const source = "return new RegExp('\\\\1(a)'+'x'.repeat(200)).test('a'+'x'.repeat(200));";
    await expect(run(source, { budget: new Budget({ maxSteps: 100 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: true });
  });
  it.each(["(a|ab)\\1", "\\2(a)(b)", "(a)?b\\1", "(?<=\\1(a))b", "(a)\\18", "[\\8\\9]", "\\777", "\\08"])("matches native across short inputs: %s", async pattern => {
    const inputs = ["", "a", "b", "aa", "ab", "aab", "abab", "baba", "888", "?7", String.fromCharCode(0)+"8", "a"+String.fromCharCode(1)+"8"];
    const source = `return ${JSON.stringify(inputs)}.map(input=>new RegExp(${JSON.stringify(pattern)},'d').exec(input));`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });
  it.each([
    "return /(a)\\1/d.exec('baa');",
    "return /(ab)\\1/i.exec('abAB');",
    "return /(a)?b\\1/d.exec('b');",
    "return /\\1(a)/d.exec('a');",
    "return /(a\\1)/.exec('a');",
    "return /(a|ab)\\1c/d.exec('ababc');",
    "return /(a|(b))+\\2/d.exec('ba');",
    "return /(?=(a+))a*b\\1/d.exec('baabac');",
    "return /(.*?)a(?!(a+)b\\2c)\\2(.*)/d.exec('baaabaac');",
    "return /(?<=\\1(a))b/d.exec('aab');",
    "return /(?<=(a)\\1)b/d.exec('ab');",
    "return /(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)\\10/.exec('abcdefghijj');",
    "return /[()]\\1/.test('(' + String.fromCharCode(1));",
    "return /(?:a)\\1/.test('a' + String.fromCharCode(1));",
    "return /\\(a\\)\\1/.test('(a)' + String.fromCharCode(1));",
    "return /\\12/.test(String.fromCharCode(10));",
    "return /\\012/.test(String.fromCharCode(10));",
    "return /\\400+/.test(' 000');",
    "return /\\8+/.exec('888');",
    "return /[\\1-\\3]+/.exec(String.fromCharCode(1,2,3));",
    "return /(a)[\\1]/.test('a' + String.fromCharCode(1));",
    "return 'aabb'.match(/(.)\\1/g);",
    "return Array.from('aabb'.matchAll(/(.)\\1/dg),match=>match.indices);",
    "return 'aabb'.replace(/(.)\\1/g,'[$1]');",
    "return 'xaaybbz'.split(/(.)\\1/);"
  ])("matches native: %s", async source => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });
});
