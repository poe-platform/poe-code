import assert from "node:assert/strict";
import test from "node:test";
import { Pattern } from "./text/regex.js";

const budget = { step() {}, async checkpoint() {}, maxBufferBytes: 65536 };
for (const [shorthand, members, nonmembers] of [
  ["w", ["a", "_", "1", "é", "漢", "𠀀", "\u0301", "Ⅷ", "²", "‿"], ["!", " ", "😀"]],
  ["d", ["1", "٣", "𝟙"], ["a", "²", "Ⅷ"]],
  ["s", [" ", "\t", "\n", "\u0085", "\u00a0", "\u2003"], ["a", "\ufeff"]],
] as const) {
  for (const [characters, expected] of [[members, true], [nonmembers, false]] as const) {
    for (const character of characters) test(`jq \\${shorthand} on ${JSON.stringify(character)}`, async () => {
      for (const bracket of [false, true]) for (const negate of [false, true]) {
        const escape = `\\${negate ? shorthand.toUpperCase() : shorthand}`;
        const pattern = new Pattern(`^${bracket ? `[${escape}]` : escape}+$`, true, false, "jq");
        assert.equal(Boolean(await pattern.find(character, budget)), negate ? !expected : expected);
        assert.equal(Boolean(await pattern.tryFindSync(character, budget)), negate ? !expected : expected);
      }
    });
  }
}
for (const word of ["é", "漢", "𠀀", "e\u0301", "٣", "‿"]) {
  test(`jq Unicode boundaries around ${word}`, async () => {
    for (const source of [`\\b${word}\\b`, `\\B${word}\\B`]) {
      const pattern = new Pattern(source, true, false, "jq");
      const input = source.startsWith("\\b") ? `!${word}!` : `a${word}b`;
      assert.equal((await pattern.find(input, budget))?.groups[0], word);
      assert.equal((await pattern.tryFindSync(input, budget))?.groups[0], word);
    }
    assert.equal(await new Pattern(`a\\b${word}`, true, false, "jq").find(`a${word}`, budget), undefined);
  });
}
for (const dialect of ["sed", "awk"] as const) test(`${dialect} retains ASCII shorthand`, async () => {
  assert.equal(await new Pattern("\\w+", true, false, dialect).find("é漢", budget), undefined);
});
