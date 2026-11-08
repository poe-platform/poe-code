import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument, serializeSubtitleDocument } from "./containers/adapters.js";

for (const timing of [
  "oops --> wrong",
  "00:01,200 --> 00:02,300",
  "1.200 --> 2.300",
  "00:01.000 --> wrong",
  "wrong --> 00:02.000",
  "00:01 --> 00:02",
]) {
  for (const preceding of ["", "00:01.000 --> 00:02.000\nHello\n\n"]) {
    it(`stops WebVTT demuxing at ${timing}, preceding cue=${Boolean(preceding)}`, () => {
      const input = `WEBVTT\n\n${preceding}${timing}\nBad\n\n00:03.000 --> 00:04.000\nGood\n`;
      const doc = parseSubtitleDocument(new TextEncoder().encode(input), "webvtt");
      assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "webvtt")),
        preceding ? `WEBVTT\n\n${preceding.trimEnd()}\n` : "WEBVTT\n");
    });
  }
}

it("retains native WebVTT integer milliseconds and timestamp suffixes", () => {
  const doc = parseSubtitleDocument(new TextEncoder().encode(
    "WEBVTT\n\n00:00:01.2 --> 00:00:02.25\nHello\n\n00:03.000x --> 00:04.000\nGood\n"
  ), "webvtt");
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration]), [[1002, 1023], [3000, 1000]]);
});
