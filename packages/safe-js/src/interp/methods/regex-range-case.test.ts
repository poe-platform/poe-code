import { describe, expect, it } from "vitest";
import { run } from "../../core.js";
import { parseRegex } from "../regex/parse.js";
import { matchRegex } from "../regex/engine.js";

describe("RegExp range case folding", () => {
  it.each(["[E-f]", "[A-z]", "[µ-ÿ]", "[µ-µ]", "[Σ-Σ]", "[a-z]", "[ſ-ſ]", "[K-K]", "[À-ö]"])("matches native range %s", pattern => {
    for (const flags of ["", "i", "iu", "iv"]) {
      const parsed = parseRegex(pattern, flags);
      const native = new RegExp(pattern, flags);
      for (const input of ["a", "A", "z", "Z", "_", "µ", "μ", "Μ", "σ", "ς", "Σ", "ſ", "s", "S", "K", "k", "K", "ß", "ẞ", "é", "É", "\n"]) {
        const actual = matchRegex(parsed, input);
        const expected = native.exec(input);
        expect(actual === null ? null : actual.text, `${pattern}/${flags} on ${input}`)
          .toEqual(expected === null ? null : expected[0]);
      }
    }
  });

  it.each([
    ["return /[E-f]+/i.exec('xyz')[0]", "xyz"],
    ["return /[^E-f]+/i.exec('xyz!')[0]", "!"],
    ["return 'xyz'.replace(/[E-f]+/ig,'!')", "!"],
    ["return /(?<=[E-f])x/i.exec('zx')[0]", "x"]
  ])("uses folded ranges across APIs: %s", async (source, expected) => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
