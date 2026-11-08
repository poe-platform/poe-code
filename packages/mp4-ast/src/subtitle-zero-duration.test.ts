import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument, serializeSubtitleDocument } from "./containers/adapters.js";
import { parseMp4, serializeMp4 } from "./mp4.js";

for (const fragmented of [false, true]) {
  it(`preserves a zero-duration subtitle and its following gap (fragmented=${fragmented})`, () => {
    const input = "1\n00:00:00,100 --> 00:00:00,100\nA\n\n2\n00:00:00,600 --> 00:00:00,900\nB\n\n";
    const bytes = serializeMp4(parseSubtitleDocument(new TextEncoder().encode(input), "srt"), { fragmented });
    const track = parseMp4(bytes, { decodeSubtitles: false }).tracks[0]!;
    assert.deepEqual(track.samples.filter(sample => sample.pts < 0.9 * track.timescale).map(sample => [
      sample.pts / track.timescale, sample.duration / track.timescale,
      new TextDecoder().decode(sample.data.subarray(2))
    ]), [[0, 0.1, ""], [0.1, 0, "A"], [0.1, 0.5, ""], [0.6, 0.3, "B"]]);
    if (!fragmented) {
      assert.equal(new TextDecoder().decode(serializeSubtitleDocument(parseMp4(bytes), "srt")), input);
    }
  });
}
