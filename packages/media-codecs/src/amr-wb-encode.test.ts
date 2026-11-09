import assert from "node:assert/strict";
import { it } from "node:test";
import { decodeAudio, encodeAudio } from "./index.js";

for (const [mode, bitrate] of [6600, 8850, 12650, 14250, 15850, 18250, 19850, 23050, 23850].entries()) {
  it(`encodes and decodes AMR-WB at ${bitrate} bits per second, padding the final frame`, () => {
    const pcm = Float32Array.from({ length: 321 }, (_, index) => Math.sin(index * 0.2) / 2);
    const encoded = encodeAudio("amr_wb", 16000, [pcm], bitrate);
    assert.equal(encoded.frameSize, 320);
    assert.equal(encoded.packets.length, 2);
    assert.ok(encoded.packets.every(packet => (packet[0]! >> 3 & 15) === mode));
    const decoded = [...decodeAudio("AMR-WB", encoded.packets.map((data, index) => ({ data, pts: index * 320, dts: index * 320, duration: 320 })))];
    assert.equal(decoded.length, 2);
    assert.ok(decoded.every(frame => frame.sampleRate === 16000 && frame.channelData.length === 1 && frame.channelData[0]!.length === 320));
    assert.ok(decoded.some(frame => frame.channelData[0]!.some(sample => Math.abs(sample) > 0.001)));
  });
}

it("rejects invalid AMR-WB input and leaves the encoder usable", () => {
  assert.throws(() => encodeAudio("amr_wb", 8000, [new Float32Array(320)]), /16000/);
  assert.throws(() => encodeAudio("amr_wb", 16000, [new Float32Array(320), new Float32Array(320)]), /mono/);
  assert.throws(() => encodeAudio("amr_wb", 16000, [new Float32Array(320)], 12000), /bitrate/);
  assert.throws(() => encodeAudio("amr_wb", 16000, [Float32Array.of(NaN)]), /finite/);
  assert.equal(encodeAudio("amr_wb", 16000, [new Float32Array(320)]).packets.length, 1);
});
