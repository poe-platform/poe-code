import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, probeWavSource, wavAst } from "./index.js";
import { readWavStreamHeader } from "./containers/wav-header.js";

function fixture(formatLength: number | undefined, afterData = false): Buffer {
  const chunk = (id: string, bytes: Buffer) => {
    const head = Buffer.alloc(8); head.write(id); head.writeUInt32LE(bytes.length, 4);
    return Buffer.concat([head, bytes, Buffer.alloc(bytes.length % 2)]);
  };
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1); format.writeUInt16LE(1, 2);
  format.writeUInt32LE(8000, 4); format.writeUInt32LE(8000, 8);
  format.writeUInt16LE(1, 12); format.writeUInt16LE(8, 14);
  const fmt = formatLength === undefined ? Buffer.alloc(0) : chunk("fmt ", format.subarray(0, formatLength));
  const data = chunk("data", Buffer.from([128, 129, 130, 131]));
  const body = Buffer.concat([Buffer.from("WAVE"), chunk("JUNK", Buffer.from("xyz")), ...(afterData ? [data, fmt] : [fmt, data])]);
  const head = Buffer.alloc(8); head.write("RIFF"); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

for (const length of [undefined, 0, 10, 13]) {
  it(`rejects WAV with format length ${length} in every header reader`, async () => {
    const bytes = fixture(length);
    assert.throws(() => parseWav(bytes), /fmt/);
    assert.throws(() => wavAst().probe(bytes), /fmt/);
    await assert.rejects(probeWavSource({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } }), /fmt/);
    await assert.rejects(readWavStreamHeader((async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })()), /fmt/);
  });
}

for (const length of [14, 16]) for (const afterData of [false, true]) {
  it(`accepts ${length}-byte format ${afterData ? "after" : "before"} data`, async () => {
    const bytes = fixture(length, afterData);
    const result = await probeWavSource({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } });
    assert.equal(result.streams[0]!.sample_rate, "8000");
    assert.equal(result.streams[0]!.channels, 1);
    assert.equal(result.streams[0]!.bits_per_sample, 8);
    assert.deepEqual(wavAst().probe(bytes), result);
    assert.equal(parseWav(bytes).tracks[0]!.decodedAudio!.channelData[0]!.length, 4);
    assert.equal((await readWavStreamHeader((async function* () { yield bytes; })())).bitsPerSample, 8);
  });
}
