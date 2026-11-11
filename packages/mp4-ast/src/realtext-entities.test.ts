import assert from "node:assert/strict";
import { it } from "node:test";
import { realtextAst } from "./containers/realtext.js";

for (const text of ["A &amp; B", "A &lt; B", "A&nbsp;B", "&#65; &#x41; &unknown; &amp;lt;", "A and B"]) {
  it(`preserves literal RealText dialogue bytes: ${text}`, () => {
    const doc = realtextAst().parse(new TextEncoder().encode(
      `<window><time begin="1" end="2"><clear/>${text}<br/>Next</window>`
    ));
    assert.equal(doc.tracks[0]!.samples.length, 1);
    const sample = doc.tracks[0]!.samples[0]!;
    assert.deepEqual(sample.data, new TextEncoder().encode(`${text}\nNext`));
    assert.equal(sample.size, sample.data.length);
    assert.equal(sample.pts, 1000);
    assert.equal(sample.duration, 1000);
  });
}
