import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, serializeWav } from "./index.js";

for (const floating of [false, true]) {
  it(`writes signed 64-bit ${floating ? "float" : "integer"} WAV samples without narrowing`, () => {
    const values = [-2, -1, -16385 / 32768, -1 / 32768, 0, 1 / 32768, 16385 / 32768, 1 - 2 ** -40, 1, 2];
    // A separately constructed IEEE float64 source exercises precision and clipping.
    const input = Buffer.alloc(44 + values.length * 8);
    input.write("RIFF", 0);
    input.writeUInt32LE(input.length - 8, 4);
    input.write("WAVEfmt ", 8);
    input.writeUInt32LE(16, 16);
    input.writeUInt16LE(3, 20);
    input.writeUInt16LE(1, 22);
    input.writeUInt32LE(8000, 24);
    input.writeUInt32LE(64000, 28);
    input.writeUInt16LE(8, 32);
    input.writeUInt16LE(64, 34);
    input.write("data", 36);
    input.writeUInt32LE(values.length * 8, 40);
    values.forEach((value, i) => input.writeDoubleLE(value, 44 + i * 8));
    const source = parseWav(input);
    assert.deepEqual(Array.from(source.tracks[0]!.decodedAudio!.channelData[0]!), values);
    const output = Buffer.from(serializeWav(source, { audioCodec: floating ? "pcm_f64le" : "pcm_s64le" }));
    assert.equal(output.readUInt16LE(20), floating ? 3 : 1);
    assert.equal(output.readUInt16LE(34), 64);
    assert.equal(output.readUInt16LE(32), 8);
    assert.equal(output.readUInt32LE(28), 64000);
    assert.equal(output.readUInt32LE(40), values.length * 8);
    values.forEach((value, i) => {
      if (floating) assert.equal(output.readDoubleLE(44 + i * 8), value);
      else assert.equal(output.readBigInt64LE(44 + i * 8),
        value >= 1 ? (1n << 63n) - 1n : value <= -1 ? -(1n << 63n) : BigInt(value * 2 ** 63));
    });
  });
}
