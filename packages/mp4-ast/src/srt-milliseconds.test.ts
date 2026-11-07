import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument, serializeSubtitleDocument } from "./containers/adapters.js";

for (const separator of [",", "."]) {
  it(`reads short SRT ${separator} fields as integer milliseconds`, () => {
    const input = `1\n00:00:01${separator}2 --> 00:00:02${separator}25\nHello\n\n2\n00:00:05${separator}000 --> 00:00:06${separator}750\nthere\n`;
    const doc = parseSubtitleDocument(new TextEncoder().encode(input), "srt");
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration]), [
      [1002, 1023], [5000, 1750]
    ]);
    assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "webvtt")),
      "WEBVTT\n\n00:00:01.002 --> 00:00:02.025\nHello\n\n00:00:05.000 --> 00:00:06.750\nthere\n");
  });
}

it("preserves WebVTT fractional-second parsing", () => {
  const doc = parseSubtitleDocument(new TextEncoder().encode(
    "WEBVTT\n\n00:01.200 --> 00:02.250\nHello\n"
  ), "webvtt");
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration]), [[1200, 1050]]);
});
