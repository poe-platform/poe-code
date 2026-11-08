import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, probeWavSource, probeWavStream, wavAst } from "./index.js";

for (const [storage, expected] of [
  [8, [-32768, -16384, 0, 16384]],
  [16, [16384, -16256, -8160, -12240]],
  [24, [-32704, -8160, 4304, -20400]],
  [32, [-16256, -12240, -20400]]
] as const) for (const bits of [storage - 4, storage]) {
  it(`decodes and probes legacy PCM ${bits} using ${storage}-bit storage`, async () => {
    const data = Buffer.from("004080c020e030d010f050b0", "hex").subarray(0, storage / 2);
    const input = Buffer.alloc(44 + data.length);
    input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
    input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(1, 22);
    input.writeUInt32LE(8000, 24); input.writeUInt32LE(8000 * storage / 8, 28);
    input.writeUInt16LE(storage / 8, 32); input.writeUInt16LE(bits, 34);
    input.write("data", 36); input.writeUInt32LE(data.length, 40); data.copy(input, 44);
    const decoded = parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(decoded, value => Math.floor(value * 32768)), expected);
    const options = { showPackets: true };
    for (const probe of [wavAst().probe(input, options),
      await probeWavSource({ size: input.length, async read(offset, length) { return input.subarray(offset, offset + length); } }, options),
      await probeWavStream((async function* () { for (const byte of input) yield Uint8Array.of(byte); })(), options)]) {
      assert.equal(probe.streams[0]!.codec_name, storage === 8 ? "pcm_u8" : `pcm_s${storage}le`);
      assert.equal(probe.streams[0]!.bits_per_sample, storage);
      assert.equal(Array.from(probe.packets!)[0]!.duration, expected.length);
    }
  });
}
