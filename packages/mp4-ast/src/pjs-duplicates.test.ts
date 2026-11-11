import assert from "node:assert/strict";
import { it } from "node:test";
import { pjsAst } from "./index.js";

it("discards adjacent and separated exact duplicate PJS cues", () => {
  const bytes = new TextEncoder().encode('10,20,"Alpha"\n10,20,"Alpha"\n30,40,"Beta"\n10,20,"Alpha"\n30,40,"Beta"\n');
  const doc = pjsAst().parse(bytes);
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
    [[10, 10, "Alpha"], [30, 10, "Beta"]]);
  assert.equal(doc.durationSeconds, 4);
});

it("preserves PJS cues with distinct start times, end times, or dialogue", () => {
  const bytes = new TextEncoder().encode('10,20,"Alpha"\n10,21,"Alpha"\n10,20,"Other"\n11,20,"Alpha"\n');
  const doc = pjsAst().parse(bytes);
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
    [[10, 10, "Alpha"], [10, 11, "Alpha"], [10, 10, "Other"], [11, 9, "Alpha"]]);
  assert.equal(doc.durationSeconds, 2.1);
});
