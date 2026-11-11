import assert from "node:assert/strict";
import { it } from "node:test";
import { realtextAst } from "./index.js";

for (const [begin, end, start, finish] of [
  ["0:01.2", "0:02.3", 1020, 2030],
  ["1.234", "2.789", 3340, 9890],
  ["1.25", "2.75", 1250, 2750],
  ["0:01:01.2", "0:01:02.3", 61020, 62030],
  ["1.002", "2.003", 1020, 2030],
  ["1", "2", 1000, 2000]
] as const) {
  it(`reads RealText ${begin} to ${end} using centisecond counts`, () => {
    const bytes = new TextEncoder().encode(
      `<window><time begin="${begin}" end="${end}"><clear/>Alpha</window>`
    );
    const doc = realtextAst().parse(bytes);
    assert.equal(doc.timescale, 1000);
    assert.equal(doc.duration, finish);
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [
      sample.pts, sample.dts, sample.duration, new TextDecoder().decode(sample.data)
    ]), [[start, start, finish - start, "Alpha"]]);
  });
}
