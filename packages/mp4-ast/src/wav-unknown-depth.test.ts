import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, probeWavSource, probeWavStream, wavAst } from "./index.js";

for (const bits of [0, 16]) it(`preserves WAV bit depth ${bits} across probe paths`, async () => {
    const input = Buffer.alloc(52);
    input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
    input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(1, 22);
    input.writeUInt32LE(8000, 24); input.writeUInt32LE(16000, 28);
    input.writeUInt16LE(2, 32); input.writeUInt16LE(bits, 34);
    input.write("data", 36); input.writeUInt32LE(8, 40);
    [100, 200, 300, 400].forEach((value, index) => input.writeInt16LE(value, 44 + index * 2));
  const options = { showPackets: true };
  const results = [wavAst().probe(input), wavAst().probe(input, options),
    await probeWavSource({ size: input.length, read: async (offset, length) => input.subarray(offset, offset + length) }, options),
    await probeWavStream((async function* () { for (let i = 0; i < input.length; i += 7) yield input.subarray(i, i + 7); })(), options)];
  for (const result of results) {
    assert.equal(result.streams[0]!.bits_per_sample, bits);
    assert.equal(result.streams[0]!.codec_name, bits ? "pcm_s16le" : undefined);
    if (!result.packets) continue;
    const packets = Array.from(result.packets);
    assert.equal(packets.length, 1);
    assert.equal(packets[0]!.size, "8");
    assert.equal(packets[0]!.pos, "44");
    assert.equal(packets[0]!.duration, bits ? 4 : undefined);
  }
  if (!bits) assert.equal(parseWav(input).tracks[0]!.decodedAudio, undefined);
});
