import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument, serializeSubtitleDocument } from "./containers/adapters.js";

it("orders SRT cues by timestamp while preserving text, overlaps and equal-time order", () => {
  const input = "1\n00:00:05,000 --> 00:00:06,000\nHello\n\n2\n00:00:01,000 --> 00:00:07,000\nthere\nagain\n\n3\n00:00:01,000 --> 00:00:02,000\nTogether\n";
  const doc = parseSubtitleDocument(new TextEncoder().encode(input), "srt");
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => [
    sample.pts, sample.dts, sample.duration, new TextDecoder().decode(sample.data)
  ]), [[1000, 1000, 6000, "there\nagain"], [1000, 1000, 1000, "Together"], [5000, 5000, 1000, "Hello"]]);
  assert.equal(doc.duration, 7000);
  assert.equal(doc.tracks[0]!.duration, 7000);
  assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "webvtt")),
    "WEBVTT\n\n00:00:01.000 --> 00:00:07.000\nthere\nagain\n\n00:00:01.000 --> 00:00:02.000\nTogether\n\n00:00:05.000 --> 00:00:06.000\nHello\n");
});
