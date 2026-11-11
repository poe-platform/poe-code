import assert from "node:assert/strict";
import { it } from "node:test";
import { pjsAst } from "./index.js";

for (const bom of [false, true]) {
  it(`PJS ${bom ? "skips a BOM-prefixed cue" : "retains an unprefixed cue"}`, () => {
    const bytes = new TextEncoder().encode(`${bom ? "\uFEFF" : ""}10,20,"Alpha"\n30,40,"Beta"\n`);
    const doc = pjsAst().parse(bytes);
    assert.deepEqual(doc.tracks[0]!.samples.map(sample =>
      [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
    bom ? [[30, 10, "Beta"]] : [[10, 10, "Alpha"], [30, 10, "Beta"]]);
    assert.equal(doc.durationSeconds, 4);
  });
}
