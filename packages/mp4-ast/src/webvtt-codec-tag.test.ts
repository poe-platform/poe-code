import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument } from "./containers/adapters.js";
import { buildProbeStream } from "./probe-stream.js";

for (const container of ["webvtt", "mp4", "mov"]) {
  it(`reports WebVTT codec tags for ${container}`, () => {
    const bytes = new TextEncoder().encode("WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n");
    const track = parseSubtitleDocument(bytes, "webvtt").tracks[0]!;
    const stream = buildProbeStream(track, track.codecDescriptions[0], {
      totalBytes: 5, count: 1, ticks: 1000, firstPts: 0, hasReorderedSamples: false
    }, 0, container);
    assert.equal(stream.codec_name, "webvtt");
    assert.equal(stream.codec_tag_string, container === "webvtt" ? "[0][0][0][0]" : "wvtt");
    assert.equal(stream.codec_tag, container === "webvtt" ? "0x0000" : "0x74747677");
  });
}
