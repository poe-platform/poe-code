import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument } from "./containers/adapters.js";
import { parseMp4, serializeMp4 } from "./mp4.js";

for (const fragmented of [false, true]) {
  for (const touching of [false, true]) {
    it(`terminates timed text without extending cues (fragmented=${fragmented}, touching=${touching})`, () => {
      const input = `1\n00:00:00,100 --> 00:00:00,500\nA\n\n2\n00:00:00,${touching ? "500" : "900"} --> 00:00:01,300\nB\n\n`;
      const doc = parseSubtitleDocument(new TextEncoder().encode(input), "srt");
      const bytes = serializeMp4(doc, { fragmented });
      const packed = parseMp4(bytes, { decodeSubtitles: false });
      const track = packed.tracks[0]!;
      assert.deepEqual(track.samples.map(sample => sample.size), touching ? [2, 3, 3, 2] : [2, 3, 2, 3, 2]);
      const last = track.samples.at(-1)!;
      assert.deepEqual([...last.data], [0, 0]);
      assert.equal(last.duration, 0);
      assert.equal(last.pts / track.timescale, 1.3);
      // Copying a complete track must preserve exactly one terminal sample.
      assert.deepEqual(parseMp4(serializeMp4(packed, { fragmented }), { decodeSubtitles: false }).tracks[0]!.samples.map(sample => sample.size), track.samples.map(sample => sample.size));
      // Packet readers can omit the final zero-duration sample before remuxing.
      const truncated = { ...packed, tracks: [{ ...track, samples: track.samples.slice(0, -1) }] };
      const copied = parseMp4(serializeMp4(truncated, { fragmented }), { decodeSubtitles: false }).tracks[0]!;
      assert.deepEqual(copied.samples.map(sample => sample.size), track.samples.map(sample => sample.size));
      assert.equal(copied.samples.at(-1)!.duration, 0);
    });
  }
}
