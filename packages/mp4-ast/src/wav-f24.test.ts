import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, probeWavSource, probeWavStream, serializeWav, wavAst } from "./index.js";

for (const [bits, valid, payload, codec] of [
  [32, 24, "0000804a000080ca0000004a000000ca", "pcm_f24le"],
  [32, 32, "00000040000000c000000020000000e0", "pcm_s32le"],
  [32, 28, "00000040000000c000000020000000e0", "pcm_s32le"],
  [24, 20, "0000400000c00000200000e0", "pcm_s24le"]
] as const) {
  it(`decodes and probes WAV ${bits}/${valid} and validates stream copy`, async () => {
    const data = Buffer.from(payload, "hex");
    const header = Buffer.from("524946460000000057415645666d742028000000feff0100401f0000000000000000000016000000040000000100000000001000800000aa00389b716461746100000000", "hex");
    header.writeUInt32LE(header.length + data.length - 8, 4);
    header.writeUInt32LE(8000 * bits / 8, 28);
    header.writeUInt16LE(bits / 8, 32);
    header.writeUInt16LE(bits, 34);
    header.writeUInt16LE(valid, 38);
    header.writeUInt32LE(data.length, 64);
    const input = Buffer.concat([header, data]);
    const doc = parseWav(input);
    assert.deepEqual(Array.from(doc.tracks[0]!.decodedAudio!.channelData[0]!, n => n * 32768), [16384, -16384, 8192, -8192]);
    for (const probe of [wavAst().probe(input), await probeWavSource({ size: input.length,
      async read(offset, length) { return input.subarray(offset, offset + length); } }),
      await probeWavStream((async function* () { for (const byte of input) yield Uint8Array.of(byte); })())]) {
      assert.equal(probe.streams[0]!.codec_name, codec);
    }
    const copy = () => serializeWav(parseWav(input, { decodeAudio: false }), { audioCodec: "copy" });
    if (codec === "pcm_f24le") assert.throws(copy, /pcm_f24le.*not supported/);
    else assert.deepEqual(parseWav(copy()).tracks[0]!.decodedAudio!.channelData, doc.tracks[0]!.decodedAudio!.channelData);
  });
}
