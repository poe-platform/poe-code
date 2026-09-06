import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

describe("RegExp lookbehind", () => {
  it("bounds backward assertion backtracking", async () => {
    await expect(run("return /(?<=b(a+)+)$/.test('a'.repeat(20));"))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    expect(await run("return /(?<=b(a+)+)$/.test('baaa');"))
      .toMatchObject({ ok: true, returnValue: true });
  });
  it("restores backward captures across a lazy iterator checkpoint", async () => {
    const source = "const iterator='ab'.matchAll(/(?<=(.))/dg);iterator.next();await 0;const next=iterator.next();return [next.value[1],next.value.indices,iterator.next().done];";
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      const expected = await runInNewContext("(async function(){'use strict';" + source + "})()");
      expect(await completed).toMatchObject({ ok: true, returnValue: expected });
      expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: expected });
    } finally { await completed; }
  });
  it.each(["(?<=([ab]+)([bc]+))$", "(?<!(a))b", "(?:(?<=(a))b|a)+", "(?<=(a|ba))", "(?<=(a)(?=b))b"])("agrees with native across short inputs: %s", async pattern => {
    const inputs = ["", "a", "b", "c", "aa", "ab", "ba", "bb", "abc", "bab", "abb"];
    const source = `return ${JSON.stringify(inputs)}.map(input=>new RegExp(${JSON.stringify(pattern)},'d').exec(input));`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });
  it.each([
    "return /(?<=a)b/.exec('ab');",
    "return /(?<!a)b/.exec('abcb');",
    "return /(?<=([ab]+)([bc]+))$/d.exec('abc');",
    "return /(?<=(a+?)(a+))b/d.exec('aaab');",
    "return /(?<=((a)|(b))+)c/d.exec('abc');",
    "return /(?<=ab|c)d/.exec('cd');",
    "return /(?<=(a|ba))c/d.exec('bac');",
    "return /(?<=(a)(?=b))b/d.exec('ab');",
    "return /(?=(?<=a)b)b/.exec('ab');",
    "return /(?<=(?<=a)b)c/.exec('abc');",
    "return /(?<!a(b))c(d)/d.exec('xcd');",
    "return /(?<=^a)b/.exec('ab');",
    "return /(?<=a$)/m.exec('a\\nb');",
    "return /(?<=.)a/.exec('a');",
    "return /(?<=.)a/s.exec('\\na');",
    "return /(?<=)/.exec('');",
    "return /(?<!)/.exec('a');",
    "return 'abac'.match(/(?<=a)./g);",
    "return Array.from('ab'.matchAll(/(?<=(.))/dg),match=>[match[1],match.indices]);",
    "return 'ab'.split(/(?<=a)/);",
    "return 'ab'.replace(/(?<=(a))/g,'[$1]');",
    "const regex=/(?<=(a))b/dy;regex.lastIndex=1;return [regex.exec('ab').indices,regex.lastIndex];",
    "try{new RegExp('(?<=a)+')}catch(error){return error.name}"
  ])("matches native: %s", async source => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });
});
