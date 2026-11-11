import assert from "node:assert/strict";
import { it } from "node:test";
import { realtextAst } from "./index.js";

for (const cues of [
  [[5, 6, "Beta"], [1, 2, "Alpha"]],
  [[1, 2, "Alpha"], [5, 6, "Beta"]],
  [[5, 6, "Beta"], [1, 3, "Alpha"], [1, 2, "Tie"]]
] as const) {
  it(`orders RealText cues by timestamp, preserving ties: ${cues.map(cue => cue[2]).join(", ")}`, () => {
    const doc = realtextAst().parse(new TextEncoder().encode(
      `<window>${cues.map(([begin, end, text]) => `<time begin="${begin}" end="${end}"><clear/>${text}`).join("")}</window>`
    ));
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [
      sample.pts, sample.dts, sample.duration, new TextDecoder().decode(sample.data)
    ]), cues.length === 3 ? [
      [1000, 1000, 2000, "Alpha"], [1000, 1000, 1000, "Tie"], [5000, 5000, 1000, "Beta"]
    ] : [[1000, 1000, 1000, "Alpha"], [5000, 5000, 1000, "Beta"]]);
    assert.equal(doc.durationSeconds, 6);
  });
}
