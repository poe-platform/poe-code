import assert from "node:assert/strict";
import { it } from "node:test";
import { lrcAst } from "./containers/lrc.js";

for (const [tag, pts] of [
  ["0:1.2", 1020],
  ["00:01.123", 2230],
  ["00:01", undefined],
  ["00:01.02", 1020]
] as const) {
  it(`reads the LRC centisecond field in [${tag}]`, () => {
    const bytes = new TextEncoder().encode(`[${tag}]line\n[00:05.00]end\n`);
    const samples = lrcAst().parse(bytes).tracks[0]!.samples;
    assert.deepEqual(samples.map(sample => [sample.pts, new TextDecoder().decode(sample.data)]),
      pts === undefined ? [[5000, "end"]] : [[pts, "line"], [5000, "end"]]);
    if (pts !== undefined) assert.equal(samples[0]!.duration, 5000 - pts);
    assert.equal(lrcAst().detect(new TextEncoder().encode(`[${tag}]line\n`)), pts !== undefined);
  });
}
