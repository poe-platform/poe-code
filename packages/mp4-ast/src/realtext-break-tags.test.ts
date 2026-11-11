import assert from "node:assert/strict";
import { it } from "node:test";
import { realtextAst } from "./containers/realtext.js";

for (const [tag, expected] of [["<br />", "AB"], ["<br/>", "A\nB"], ["<br>", "A\nB"]]) {
  it(`decodes the RealText break spelling ${tag}`, () => {
    const doc = realtextAst().parse(new TextEncoder().encode(
      `<window><time begin="1" end="2"><clear/>A${tag}B</window>`
    ));
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [
      sample.pts, sample.duration, new TextDecoder().decode(sample.data)
    ]), [[1000, 1000, expected]]);
  });
}
