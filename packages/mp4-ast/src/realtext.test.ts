import assert from "node:assert/strict";
import { it } from "node:test";
import { realtextAst } from "./index.js";

for (const begin of ["", ' begin="0"']) {
  it(`starts a RealText cue at zero with ${begin ? "explicit" : "omitted"} begin`, () => {
    const doc = realtextAst().parse(new TextEncoder().encode(
      `<window><time${begin} end="2"><clear/>Alpha</window>`
    ));
    assert.equal(doc.durationSeconds, 2);
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [
      sample.pts, sample.duration, new TextDecoder().decode(sample.data)
    ]), [[0, 2000, "Alpha"]]);
  });
}

it("defaults each omitted RealText begin to zero without accepting malformed begin values", () => {
  const doc = realtextAst().parse(new TextEncoder().encode(
    '<window><time begin="1" end="2"><clear/>First' +
    '<time end="3"><clear/>Second' +
    '<time begin="invalid" end="4"><clear/>Invalid</window>'
  ));
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => [
    sample.pts, sample.duration, new TextDecoder().decode(sample.data)
  ]), [[1000, 1000, "First"], [0, 3000, "Second"]]);
});
