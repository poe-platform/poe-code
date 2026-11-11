import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument } from "./containers/adapters.js";
import { sliceMp4 } from "./mp4.js";

for (const inputSeek of [false, true]) {
  it(`subtitle slicing keeps whole packets and honors bounds (inputSeek=${inputSeek})`, () => {
    const doc = parseSubtitleDocument(new TextEncoder().encode(
      "1\n00:00:00,000 --> 00:00:01,000\nExpired\n\n" +
      "2\n00:00:01,000 --> 00:00:04,000\nOverlap\n\n" +
      "3\n00:00:02,500 --> 00:00:05,500\nInside\n\n" +
      "4\n00:00:06,000 --> 00:00:07,000\nOutside\n"), "srt");
    const result = sliceMp4(doc, { startSeconds: 2, endSeconds: 6, inputSeek, resetTimestamps: false });
    assert.deepEqual(result.tracks[0]!.samples, doc.tracks[0]!.samples.slice(inputSeek ? 1 : 2, 3));
    assert.equal(result.durationSeconds, 5.5);
    assert.equal(doc.tracks[0]!.samples.length, 4);
  });
}
