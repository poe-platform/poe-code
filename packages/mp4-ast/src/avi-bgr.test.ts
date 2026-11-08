import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAvi, probeAvi, serializeAvi } from "./containers/avi.js";

// Native FFmpeg: 72 RGB bytes (i * 7 + 11) % 256, 3x2 at 5 fps,
// -f rawvideo -pixel_format rgb24 -video_size 3x2 -framerate 5
// -c:v rawvideo -pix_fmt bgr24. Each 9-byte row is padded to 12 bytes.
const fixture = readFileSync(new URL("./fixtures/bgr24.avi", import.meta.url));
for (const topDown of [false, true]) {
  it(`copies BI_RGB headers, padded packets and decoded pixels (topDown=${topDown})`, () => {
    const input = Buffer.from(fixture);
    input.writeInt32LE(topDown ? -2 : 2, input.indexOf("strf") + 16);
    const doc = parseAvi(new Uint8Array(input));
    const copied = serializeAvi(doc);
    const probe = probeAvi(copied, { showPackets: true });
    assert.equal(probe.streams[0]!.codec_name, "rawvideo");
    assert.equal(probe.streams[0]!.pix_fmt, "bgr24");
    assert.equal(probe.streams[0]!.width, 3);
    assert.equal(probe.streams[0]!.height, 2);
    assert.equal(probe.streams[0]!.avg_frame_rate, "5/1");
    const actual = parseAvi(copied).tracks[0]!;
    assert.deepEqual(actual.samples.map(s => s.size), [24, 24, 24, 24]);
    assert.deepEqual(actual.samples, doc.tracks[0]!.samples);
    assert.deepEqual(actual.decodedVideoFrames, doc.tracks[0]!.decodedVideoFrames);
    if (topDown) {
      const rgb = actual.decodedVideoFrames!.flatMap(frame => [...frame.data].filter((_, i) => i % 4 !== 3));
      assert.deepEqual(rgb, Array.from({ length: 72 }, (_, i) => (i * 7 + 11) % 256));
    }
  });
}
