import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument } from "./containers/adapters.js";
import { parseMp4, serializeMp4 } from "./mp4.js";

for (const fragmented of [false, true]) {
  it(`keeps equal-start subtitle cues one microsecond apart (fragmented=${fragmented})`, () => {
    const input = "1\n00:00:00,100 --> 00:00:00,500\nA\n\n2\n00:00:00,100 --> 00:00:00,900\nB\n\n";
    const doc = parseSubtitleDocument(new TextEncoder().encode(input), "srt");
    const track = parseMp4(serializeMp4(doc, { fragmented }), { decodeSubtitles: false }).tracks[0]!;
    assert.equal(track.timescale, 1_000_000);
    assert.deepEqual(track.samples.filter(sample => sample.data.length > 2).map(sample => [
      sample.pts, sample.duration, new TextDecoder().decode(sample.data.subarray(2))
    ]), [[100000, 1, "A"], [100001, 800000, "B"]]);
  });
}
