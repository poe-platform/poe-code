import assert from "node:assert/strict";
import { it } from "node:test";
import { realtextAst } from "./index.js";

for (const suffix of ["", "\n", "  ", "\t\r\n "]) {
  it(`retains one RealText separator after the closing window for ${JSON.stringify(suffix)}`, () => {
    const doc = realtextAst().parse(new TextEncoder().encode(
      '<window><time begin="1" end="2"><clear/>First' +
      `<time begin="3" end="4"><clear/>Alpha</window>${suffix}`
    ));
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [
      sample.pts, sample.duration, new TextDecoder().decode(sample.data), sample.size
    ]), [[1000, 1000, "First", 5], [3000, 1000, suffix ? "Alpha " : "Alpha", suffix ? 6 : 5]]);
  });
}

it("does not create an empty RealText caption from a trailing separator", () => {
  const doc = realtextAst().parse(new TextEncoder().encode(
    '<window><time begin="1" end="2"><clear/></window>\n'
  ));
  assert.deepEqual(doc.tracks[0]!.samples, []);
});
