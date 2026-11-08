import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, probeWavSource, wavAst } from "./index.js";
import { readWavHeader, readWavSourceHeader, readWavStreamHeader } from "./containers/wav-header.js";

for (const [tag, bits, codec, payload, expected] of [
  [3, 32, "pcm_f32le", "0000003f000000bf0000803e000080be", [16384, -16384, 8192, -8192]],
  [3, 64, "pcm_f64le", "000000000000e03f000000000000e0bf", [16384, -16384]],
  [6, 8, "pcm_alaw", "004080c0", [-5504, -344, 5504, 344]],
  [7, 8, "pcm_mulaw", "004080c0", [-32124, -1884, 32124, 1884]],
  [1, 32, "pcm_s32le", "00000040000000c000000020000000e0", [16384, -16384, 8192, -8192]]
] as const) {
  it(`uses the extensible ${codec} subtype for decoding and all header/probe routes`, async () => {
    const data = Buffer.from(payload, "hex");
    const bytes = Buffer.from("524946460000000057415645666d742028000000feff0100401f0000000000000000000016000000040000000000000000001000800000aa00389b716461746100000000", "hex");
    bytes.writeUInt32LE(bytes.length + data.length - 8, 4);
    bytes.writeUInt32LE(8000 * bits / 8, 28);
    bytes.writeUInt16LE(bits / 8, 32);
    bytes.writeUInt16LE(bits, 34);
    bytes.writeUInt16LE(bits, 38);
    bytes.writeUInt32LE(tag, 44);
    bytes.writeUInt32LE(data.length, 64);
    const input = Buffer.concat([bytes, data]);
    const source = { size: input.length, async read(offset: number, length: number) {
      return input.subarray(offset, offset + Math.min(length, 3));
    } };
    const track = parseWav(input).tracks[0]!;
    assert.deepEqual(Array.from(track.decodedAudio!.channelData[0]!, n => n * 32768), expected);
    assert.equal(track.decodedAudio!.channelMask, 4);
    assert.equal(readWavHeader(input).formatTag, tag);
    assert.equal((await readWavSourceHeader(source)).formatTag, tag);
    assert.equal((await readWavStreamHeader((async function* () {
      for (const byte of input) yield Uint8Array.of(byte);
    })())).formatTag, tag);
    assert.equal((await wavAst().probe!(input)).streams[0]!.codec_name, codec);
    assert.equal((await probeWavSource(source)).streams[0]!.codec_name, codec);
  });
}
