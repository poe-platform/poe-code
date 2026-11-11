import assert from "node:assert/strict";
import { it } from "node:test";
import { samiAst } from "./containers/sami.js";

for (const [input, caption] of [
  ["A<!--note-->B", "A<!--note-->B"],
  ["A<custom>B</custom>C", "ABC"],
  ["AB", "AB"]
]) {
  it(`preserves SAMI comments while stripping ordinary tags: ${input}`, () => {
    const doc = samiAst().parse(new TextEncoder().encode(`<SAMI>\n<!--header--><BODY>\n<SYNC Start=1000><!--before paragraph--><P>${input}\n<SYNC Start=3000><P>done\n</BODY><!--footer-->\n</SAMI>\n`));
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
      [[1000, 2000, caption], [3000, 0xffffffff, "done"]]);
  });
}
