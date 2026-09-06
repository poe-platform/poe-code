import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";
import { Budget } from "../budget.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

describe("Unicode RegExp matching", () => {
  it("counts each Unicode class comparison toward the matcher ceiling", async () => {
    await expect(run("try{return new RegExp('['+'a'.repeat(2100)+']','u').test('b')}catch(error){return 'caught'}"))
      .rejects.toMatchObject({ code: "budgetExceeded" });
    expect(await run("return new RegExp('['+'a'.repeat(100)+']','u').test('b')"))
      .toMatchObject({ ok: true, returnValue: false });
  });
  it("preserves Unicode iterator advancement through checkpoint replay", async () => {
    const source = "const iterator='😀x'.matchAll(/(?<x>.)/dgu);const first=iterator.next().value;await 0;return [first.groups.x,first.indices,iterator.next().value.indices,iterator.next().done];";
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      const expected = await runInNewContext("(async function(){'use strict';" + source + "})()");
      expect(await completed).toMatchObject({ ok: true, returnValue: expected });
      expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: expected });
    } finally { await completed; }
  });

  it("keeps Unicode backtracking failures fatal", async () => {
    await expect(run("try{return /^(😀+)+x/u.test('😀'.repeat(16))}catch(error){return 'caught'}"))
      .rejects.toMatchObject({ code: "budgetExceeded" });
    expect(await run("return /^(😀+)+x/u.test('😀😀x')")).toMatchObject({ ok: true, returnValue: true });
  });

  it("charges Unicode property compilation against the caller budget", async () => {
    const source = "return /\\p{Script_Extensions=Greek}+/u.test('αβ')";
    await expect(run(source, { budget: new Budget({ maxSteps: 10 }) })).rejects.toMatchObject({ code: "budgetExceeded" });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: true });
  });

  it.each([
    ["\\ud83d\\ude00+", "😀😀"], ["\\u{d83d}\\u{de00}+", "😀😀"],
    ["\\ud83d\ude00+", "😀😀"], ["\ud83d\\ude00+", "😀😀"],
    ["[\\ud83d\\ude00]+", "😀😀"], ["[^]", "\ud83d"],
    ["\\ud83d", "😀"], ["\\ude00", "😀"],
    ["(?<=\\1(😀))x", "😀😀x"], ["(𐐀)\\1", "𐐀𐐨"],
    ["[𐐀-𐐧]+", "𐐨𐐩"], ["[\\P{L}]", "😀"],
    ["[\\p{L}\\P{L}]", "😀"], ["[^\\w]", "K"],
    ["\\p{Any}+", "😀\ud800x"], ["\\p{ASCII_Hex_Digit}+", "Ab12"],
    ["[\\b]", "\b"], ["[\\-]", "-"]
  ])("matches Unicode boundary/control %s", async (pattern, input) => {
    const expected = new RegExp(pattern, "diu").exec(input);
    const source = `return new RegExp(${JSON.stringify(pattern)},'diu').exec(${JSON.stringify(input)})`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    "return /./du.exec('😀');",
    "return /😀+/du.exec('😀😀');",
    "return /[😀-🙏]+/du.exec('😀😁🙏');",
    "return /[^a]+/du.exec('😀a');",
    "return /\\u{1f600}+/du.exec('😀😀');",
    "return /\\uD83D\\uDE00+/du.exec('😀😀');",
    "return /[\\u{1f600}-\\u{1f64f}]/du.exec('😁');",
    "return /(?<face>😀)\\k<face>/du.exec('😀😀');",
    "return /(?<=([😀-🙏]+))x/du.exec('😀😁x');",
    "return Array.from('😀x'.matchAll(/./dgu),match=>[match[0],match.indices]);",
    "return '😀'.match(/(?:)/gu);",
    "return '😀x'.split(/(?:)/u);",
    "return '😀'.replace(/(?:)/gu,'-');",
    "const regex=/./dug;regex.lastIndex=1;const match=regex.exec('😀x');return [match.index,match[0],regex.lastIndex];",
    "const regex=/./duy;regex.lastIndex=1;const match=regex.exec('😀x');return [match.index,match[0],regex.lastIndex];",
    "return [/k/iu.test('K'),/s/iu.test('ſ'),/i/iu.test('ı'),/ß/iu.test('ẞ')];",
    "return /[a-z]+/iu.exec('Kſ');",
    "return /\\b\\w+\\b/iu.exec('Kſ');",
    "return /(k)\\1/iu.exec('kK');",
    "return /\\p{Script=Greek}+/u.exec('abcαβ');",
    "return /\\p{Emoji}/du.exec('😀');",
    "return /[\\p{L}0-9]+/u.exec('α2');",
    "return [/\\P{Lowercase_Letter}/iu.test('a'),/[^\\p{Lowercase_Letter}]/iu.test('a')];",
    "return /\\cA/u.test(String.fromCharCode(1));",
    "return /\\0/u.test(String.fromCharCode(0));",
    "return /(?<π>.)\\k<π>/u.exec('😀😀');"
  ])("matches native: %s", async source => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["\\1", "\\01", "\\8", "\\a", "\\-", "[\\1]", "(?=a)+", "{", "}", "]", "a{b}", "\\u{110000}", "\\u{}", "\\c1", "\\k<x>", "\\p{not_a_property}"])("rejects invalid Unicode syntax: %s", async pattern => {
    expect(() => new RegExp(pattern, "u")).toThrow(SyntaxError);
    const source = `try{new RegExp(${JSON.stringify(pattern)},'u')}catch(error){return error.name}`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: "SyntaxError" });
  });
});
