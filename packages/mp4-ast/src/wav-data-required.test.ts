import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, probeWavSource, wavAst } from "./index.js";
import { readWavStreamHeader } from "./containers/wav-header.js";

for (const present of [false, true]) {
  it(`${present ? "accepts empty" : "rejects missing"} WAV data in every reader`, async () => {
    const bytes = Buffer.alloc(48 + (present ? 8 : 0));
    bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28);
    bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
    bytes.write("JUNK", 36); bytes.writeUInt32LE(3, 40); bytes.write("xyz", 44);
    if (present) bytes.write("data", 48);
    const source = { size: bytes.length, async read(offset: number, length: number) { return bytes.subarray(offset, offset + length); } };
    const stream = (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })();
    if (!present) {
      assert.throws(() => parseWav(bytes), /data/);
      assert.throws(() => wavAst().probe(bytes), /data/);
      await assert.rejects(probeWavSource(source), /data/);
      await assert.rejects(readWavStreamHeader(stream), /data/);
    } else {
      assert.equal(parseWav(bytes).tracks[0]!.decodedAudio!.channelData[0]!.length, 0);
      const probe = await probeWavSource(source);
      assert.equal(probe.streams[0]!.sample_rate, "8000");
      assert.deepEqual(wavAst().probe(bytes), probe);
      assert.equal((await readWavStreamHeader(stream)).dataSize, 0);
    }
  });
}
