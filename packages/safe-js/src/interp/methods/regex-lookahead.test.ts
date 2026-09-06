import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

describe("RegExp lookahead", () => {
  it("keeps assertion backtracking inside the regex execution limit", async () => {
    await expect(run("return /(?=(a+)+b)/.test('a'.repeat(20));"))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    expect(await run("return /(?=(a+)+b)/.test('aaab');"))
      .toMatchObject({ ok: true, returnValue: true });
  });
  it("restores lookahead compilation and lazy captures across a checkpoint", async () => {
    const source = "const iterator='ab'.matchAll(/(?=(.))/dg);iterator.next();await 0;const next=iterator.next();return [next.value[1],next.value.indices,iterator.next().done];";
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      const expected = await runInNewContext("(async function(){'use strict';" + source + "})()");
      expect(await completed).toMatchObject({ ok: true, returnValue: expected });
      expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: expected });
    } finally { await completed; }
  });
  it.each(["(?=(a|ab))ab", "(?!(a))b", "(?:(?=(a))a|b)+", "(?=(a?))*a?", "(?!(a+)+b)a*"])("agrees with native across short inputs: %s", async pattern => {
    const inputs = ["", "a", "b", "aa", "ab", "ba", "bb", "aab", "aba", "abb"];
    const source = `return ${JSON.stringify(inputs)}.map(input=>new RegExp(${JSON.stringify(pattern)},'d').exec(input));`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });
  it.each([
    "return /a(?=b)/.exec('xab');",
    "return /a(?!b)/.exec('abac');",
    "return /(?=(ab))a/d.exec('ab');",
    "return /(?!a(b))a(c)/d.exec('ac');",
    "return /(?=(a|ab))ab/d.exec('ab');",
    "return /(?=(a+))a/d.exec('aaa');",
    "return /(?=(a+?))a/d.exec('aaa');",
    "return /(?!(?!a))a/.exec('a');",
    "return /(?=)/.exec('');",
    "return /(?!)/.exec('a');",
    "return /(?=(a))?a/d.exec('a');",
    "return /(?=(a))+a/d.exec('a');",
    "return /(?:(?=(a))a|b)+/d.exec('ab');",
    "return 'abac'.match(/a(?=b|c)/g);",
    "return Array.from('ab'.matchAll(/(?=(.))/dg),match=>[match[0],match[1],match.indices]);",
    "return 'ab'.split(/(?=b)/);",
    "return 'ab'.replace(/(?=(b))/g,'[$1]');",
    "const regex=/(?=(a))/dy;regex.lastIndex=1;return [regex.exec('ba').indices,regex.lastIndex];"
  ])("matches native: %s", async source => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });
});
