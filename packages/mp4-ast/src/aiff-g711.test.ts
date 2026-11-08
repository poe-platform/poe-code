import assert from "node:assert/strict";
import { it } from "node:test";
import { parseAiff, aiffAst } from "./containers/aiff.js";

// Native FFmpeg fixtures and PCM16 readback from [100, -200, 300, -400], mono 8 kHz.
const fixtures = [
  ["alaw", "464f524d00000044414946434656455200000004a2805140434f4d4d000000180001000000040008400bfa00000000000000616c6177000053534e440000000c0000000000000000d359c74c", "680038ff280168fe"],
  ["mulaw", "464f524d00000044414946434656455200000004a2805140434f4d4d000000180001000000040008400bfa00000000000000756c6177000053534e440000000c0000000000000000f26be45f", "68003cff340174fe"]
] as const;

for (const [codec, hex, expected] of fixtures) {
  it(`reads and probes native ${codec} AIFF-C`, () => {
    const bytes = Buffer.from(hex, "hex");
    const doc = parseAiff(bytes);
    const samples = Buffer.from(expected, "hex");
    assert.deepEqual(Array.from(doc.tracks[0]!.decodedAudio!.channelData[0]!, value => value * 32768),
      Array.from({ length: 4 }, (_, i) => samples.readInt16LE(i * 2)));
    assert.equal(doc.durationSeconds, 4 / 8000);
    const encoded = parseAiff(bytes, { decodeAudio: false });
    assert.equal(encoded.tracks[0]!.decodedAudio, undefined);
    assert.equal(encoded.tracks[0]!.samples[0]!.size, 4);
    const stream = aiffAst().probe(bytes).streams[0]!;
    assert.equal(stream.codec_name, `pcm_${codec}`);
    assert.equal(stream.sample_rate, "8000");
    assert.equal(stream.channels, 1);
  });
}
