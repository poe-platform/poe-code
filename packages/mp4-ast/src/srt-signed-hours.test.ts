import assert from "node:assert/strict";
import { it } from "node:test";
import { isSrtSignature, parseSubtitleDocument } from "./containers/adapters.js";

for (const [start, end, pts, duration, detectable] of [
  ["-00:00:01,000", "00:00:02,000", 1000, 1000, true],
  ["-01:00:00,000", "00:00:03,000", -3600000, 3603000, true],
  ["+00:00:01,000", "00:00:02,000", 1000, 1000, false],
  ["-02:00:00,000", "-01:00:00,000", -7200000, 3600000, true],
  ["00:00:01,000", "+00:00:02,000", 1000, 1000, false]
] as const) {
  it(`reads signed SRT hours: ${start} --> ${end}`, () => {
    const bytes = new TextEncoder().encode(`1\n${start} --> ${end}\nHi\n`);
    assert.equal(isSrtSignature(bytes), detectable);
    const doc = parseSubtitleDocument(bytes, "srt");
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration]), [[pts, duration]]);
  });
}
