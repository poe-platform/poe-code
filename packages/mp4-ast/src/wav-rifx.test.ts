import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, probeWavSource, probeWavStream, serializeWav, wavAst } from "./index.js";

for (const littleEndian of [false, true]) for (const bits of [8, 16, 24, 32, 64]) {
  it(`decodes and probes ${littleEndian ? "RIFF" : "RIFX"} PCM${bits}`, async () => {
    const values = [-1, -0.5, 0, 0.5];
    const width = bits / 8;
    const bytes = Buffer.alloc(54 + values.length * width);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    bytes.write(littleEndian ? "RIFF" : "RIFX");
    view.setUint32(4, bytes.length - 8, littleEndian);
    bytes.write("WAVEJUNK", 8);
    view.setUint32(16, 1, littleEndian); // Odd chunk size exercises padding.
    bytes.write("fmt ", 22);
    view.setUint32(26, 16, littleEndian);
    view.setUint16(30, 1, littleEndian);
    view.setUint16(32, 1, littleEndian);
    view.setUint32(34, 8000, littleEndian);
    view.setUint32(38, 8000 * width, littleEndian);
    view.setUint16(42, width, littleEndian);
    view.setUint16(44, bits, littleEndian);
    bytes.write("data", 46);
    view.setUint32(50, values.length * width, littleEndian);
    values.forEach((value, i) => {
      const offset = 54 + i * width;
      if (bits === 8) bytes[offset] = value * 128 + 128;
      else if (bits === 64) view.setBigInt64(offset, BigInt(value * 2 ** 63), littleEndian);
      else if (littleEndian) bytes.writeIntLE(value * 2 ** (bits - 1), offset, width);
      else bytes.writeIntBE(value * 2 ** (bits - 1), offset, width);
    });
    assert.equal(wavAst().detect(bytes), true);
    const doc = parseWav(bytes);
    assert.deepEqual(Array.from(doc.tracks[0]!.decodedAudio!.channelData[0]!), values);
    const codec = bits === 8 ? "pcm_u8" : `pcm_s${bits}${littleEndian ? "le" : "be"}`;
    assert.equal(doc.tracks[0]!.codecDescriptions[0]!.codecName, codec);
    const source = await probeWavSource({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) });
    const stream = await probeWavStream((async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })());
    for (const probe of [source, stream]) {
      assert.equal(probe.streams[0]!.codec_name, codec);
      assert.equal(Number(probe.streams[0]!.sample_rate), 8000);
    }
    const output = parseWav(serializeWav(doc, { audioCodec: "pcm_s16le" }));
    assert.deepEqual(Array.from(output.tracks[0]!.decodedAudio!.channelData[0]!), values);
    if (!littleEndian && bits > 8) assert.throws(() => serializeWav(doc, { audioCodec: "copy" }), /not supported in WAVE/);
    else assert.deepEqual(Array.from(parseWav(serializeWav(doc, { audioCodec: "copy" })).tracks[0]!.decodedAudio!.channelData[0]!), values);
  });
}
