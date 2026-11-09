import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeAudio } from "./index.js";

for (const [bitrate, size] of [[undefined, 32], [11000, 27], [4750, 13], [5150, 14], [5900, 16], [6700, 18], [7400, 20], [7950, 21], [10200, 27], [12200, 32]]) {
  it(`encodes AMR-NB at ${bitrate} bits per second with delayed flushing`, () => {
    const encoded = encodeAudio("amr_nb", 8000, [new Float32Array(960)], bitrate);
    assert.equal(encoded.delay, 50);
    assert.equal(encoded.frameSize, 160);
    assert.equal(encoded.packets.length, 7);
    assert.ok(encoded.packets.every(packet => packet.length === size));
  });
}
it("validates AMR-NB dimensions and releases the encoder after invalid PCM", () => {
  assert.throws(() => encodeAudio("amr_nb", 16000, [new Float32Array(160)]), /AMR-NB/);
  assert.throws(() => encodeAudio("amr_nb", 8000, [new Float32Array(160), new Float32Array(160)]), /AMR-NB/);
  assert.throws(() => encodeAudio("amr_nb", 8000, [Float32Array.of(NaN)]), /finite/);
  assert.equal(encodeAudio("amr_nb", 8000, [Float32Array.of(0)], 12200).packets.length, 1);
});
