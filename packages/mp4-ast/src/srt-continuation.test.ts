import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument } from "./containers/adapters.js";

for (const separator of ["\n", "\n\n", "\n \t\n\n"]) {
  for (const nextCue of [false, true]) {
    it(`retains SRT continuation with ${JSON.stringify(separator)} and next cue ${nextCue}`, () => {
      const input = `1\n00:00:01,000 --> 00:00:02,000\nalpha${separator}third\n${nextCue ? "\n2\n00:00:01,500 --> 00:00:03,000\nbeta\n" : ""}`;
      const doc = parseSubtitleDocument(new TextEncoder().encode(input), "srt");
      assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
        [[1000, 1000, "alpha\nthird"], ...(nextCue ? [[1500, 1500, "beta"]] : [])]);
    });
  }
}
