import assert from "node:assert/strict";
import { it } from "node:test";
import { realtextAst } from "./containers/realtext.js";

for (const count of [1, 2, 3]) {
  it(`preserves ${count} consecutive RealText dialogue breaks`, () => {
    const doc = realtextAst().parse(new TextEncoder().encode(
      `<window><time begin="1" end="2"><clear/>A${"<br/>".repeat(count)}B</window>`
    ));
    assert.equal(new TextDecoder().decode(doc.tracks[0]!.samples[0]!.data), `A${"\n".repeat(count)}B`);
  });
}
