import assert from "node:assert/strict";
import { it } from "node:test";
import { readWavHeader, readWavSourceHeader, readWavStreamHeader } from "./containers/wav-header.js";

for (const samples of [[], [11, 22, 33, 44, -55, -66, -77, -88], [24932, 24948, 4, 0, -100, -200]]) {
  it(`reads ${samples.length} samples after a zero data size through EOF in every header reader`, async () => {
    const bytes = Buffer.alloc(44 + samples.length * 2);
    bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28);
    bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36);
    samples.forEach((sample, index) => bytes.writeInt16LE(sample, 44 + index * 2));
    const header = readWavHeader(bytes);
    assert.equal(header.dataOffset, 44);
    assert.equal(header.dataSize, samples.length * 2);
    assert.deepEqual(await readWavSourceHeader({ size: bytes.length, async read(offset, length) {
      assert.ok(offset + length <= 44, "must not read PCM payload");
      return bytes.subarray(offset, offset + length);
    }}), header);
    for (const chunkSize of [1, 7, 1024]) {
      assert.deepEqual(await readWavStreamHeader((async function* () {
        for (let offset = 0; offset < bytes.length; offset += chunkSize) yield bytes.subarray(offset, offset + chunkSize);
      })()), header);
    }
  });
}
