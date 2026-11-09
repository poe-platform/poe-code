import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument } from "./containers/adapters.js";

for (const separator of ["", "2\n", "\n2\n"]) {
  it(`recognizes SRT cue boundaries with separator ${JSON.stringify(separator)}`, () => {
    const input = `1\n00:00:01,000 --> 00:00:02,000\nalpha\n${separator}00:00:01,500 --> 00:00:03,000\nbeta\n`;
    const doc = parseSubtitleDocument(new TextEncoder().encode(input), "srt");
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
      [[1000, 1000, "alpha"], [1500, 1500, "beta"]]);
  });
}

it("retains numeric dialogue and arrows that are not timing lines", () => {
  const input = "1\n00:00:01,000 --> 00:00:02,000\nalpha\n2\nwords --> more words\n";
  const doc = parseSubtitleDocument(new TextEncoder().encode(input), "srt");
  assert.equal(new TextDecoder().decode(doc.tracks[0]!.samples[0]!.data), "alpha\n2\nwords --> more words");
});
