import { describe, expect, it } from "vitest";
import { run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { parseRegex } from "../regex/parse.js";
import { matchRegex } from "../regex/engine.js";

describe("Legacy RegExp grammar", () => {
  it("preserves legacy patterns through checkpoint replay", async () => {
    const source = "const iterator='a{b}a{b}'.matchAll(/a{b}/dg);const first=iterator.next().value;await 0;return [first[0],iterator.next().value.indices,iterator.next().done];";
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      const expected = { ok: true, returnValue: ["a{b}", [[4, 8]], true] };
      expect(await completed).toMatchObject(expected);
      expect(await run(source, { snapshot })).toMatchObject(expected);
    } finally { await completed; }
  });

  it.each(["[\\d-a-z]", "[a-\\d-z]", "[\\c-]", "[\\c\\d]", "\\c[ab]", "\\x2z", "\\u{1,2}", "a{2,1x}"])("matches adjacent legacy cases: %s", pattern => {
    const parsed = parseRegex(pattern);
    const native = new RegExp(pattern);
    for (const input of ["", "a", "m", "z", "0", "-", "\\", "c", "\\ca", "x2z", "u", "uu", "a{2,1x}"]) {
      const actual = matchRegex(parsed, input);
      const expected = native.exec(input);
      expect(actual === null ? null : [actual.index, actual.text], `${pattern} on ${input}`)
        .toEqual(expected === null ? null : [expected.index, expected[0]]);
    }
  });

  it.each([
    ["\\p{L}", "p{L}"], ["\\P{Letter}", "P{Letter}"],
    ["\\xZ", "xZ"], ["\\x1+", "x111"], ["\\uZZZZ", "uZZZZ"],
    ["\\u{2}", "uu"], ["[\\xZ]", "x"], ["[\\uZZZZ]", "u"],
    ["{", "{"], ["}", "}"], ["]", "]"], ["a{b}", "a{b}"],
    ["a{2", "a{2"], ["a{2,", "a{2,"], ["a{2,x}", "a{2,x}"],
    ["a{b}+", "a{b}}"], ["{x}+", "{x}}"],
    ["a{999999999999999999999x}", "a{999999999999999999999x}"],
    ["a{1,999999999999999999999x}", "a{1,999999999999999999999x}"],
    ["[\\d-a]", "-"], ["[a-\\d]", "5"], ["[\\d-\\w]", "x"],
    ["[\\d-a-z]", "z"], ["[\\D-a]", "b"],
    ["\\cA", String.fromCharCode(1)], ["\\cz", String.fromCharCode(26)],
    ["\\c1", "\\c1"], ["\\c1", "c1"], ["\\c+", "\\ccc"],
    ["[\\c1]", String.fromCharCode(17)], ["[\\c_]", String.fromCharCode(31)],
    ["[\\c-]", "\\"], ["[\\c]", "c"], ["\\c", "\\c"]
  ])("matches native legacy syntax %s", async (pattern, input) => {
    const expected = new RegExp(pattern, "d").exec(input);
    expect(await run(`return new RegExp(${JSON.stringify(pattern)},'d').exec(${JSON.stringify(input)})`))
      .toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["\\xZ", "\\uZZZZ", "a{b}", "{", "[\\d-a]", "\\c1", "[\\c1]"])("keeps Unicode syntax strict: %s", async pattern => {
    for (const flags of ["u", "v"]) {
      expect(() => new RegExp(pattern, flags)).toThrow(SyntaxError);
      expect(await run(`try{new RegExp(${JSON.stringify(pattern)},${JSON.stringify(flags)})}catch(error){return error.name}`))
        .toMatchObject({ ok: true, returnValue: "SyntaxError" });
    }
  });

  it.each(["{2}", "a{2,1}", "a{1}*", "[z-a]"])("keeps real syntax errors: %s", async pattern => {
    expect(() => new RegExp(pattern)).toThrow(SyntaxError);
    expect(await run(`try{new RegExp(${JSON.stringify(pattern)})}catch(error){return error.name}`))
      .toMatchObject({ ok: true, returnValue: "SyntaxError" });
  });
});
