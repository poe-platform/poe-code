import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument } from "./containers/adapters.js";
import { parseMp4, serializeMp4 } from "./mp4.js";

for (const [name, firstEnd, secondStart, secondEnd] of [
  ["overlapping", 1100, 600, 1300],
  ["nested", 1600, 600, 1000],
  ["separated", 500, 900, 1300],
  ["touching", 600, 600, 900]
] as const) {
  for (const fragmented of [false, true]) {
    it(`preserves ${name} subtitle starts in ${fragmented ? "fragmented" : "regular"} MP4`, () => {
      const timestamp = (ms: number) => `00:00:${String(Math.floor(ms / 1000)).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
      const input = `1\n00:00:00,100 --> ${timestamp(firstEnd)}\nA\n\n2\n${timestamp(secondStart)} --> ${timestamp(secondEnd)}\nB\n\n`;
      const doc = parseSubtitleDocument(new TextEncoder().encode(input), "srt");
      const output = parseMp4(serializeMp4(doc, { fragmented }), { decodeSubtitles: false });
      const track = output.tracks[0]!;
      assert.deepEqual(track.samples.filter(sample => sample.data.length > 2).map(sample => [
        sample.pts * 1000 / track.timescale,
        (sample.pts + sample.duration) * 1000 / track.timescale,
        new TextDecoder().decode(sample.data.subarray(2))
      ]), [[100, Math.min(firstEnd, secondStart), "A"], [secondStart, secondEnd, "B"]]);
    });
  }
}
