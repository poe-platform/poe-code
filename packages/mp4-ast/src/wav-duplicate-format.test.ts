import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, probeWavSource, wavAst } from "./index.js";
import { readWavStreamHeader } from "./containers/wav-header.js";

function fixture(duplicate: boolean): Buffer {
  const chunk = (id: string, bytes: Buffer) => {
    const head = Buffer.alloc(8); head.write(id); head.writeUInt32LE(bytes.length, 4);
    return Buffer.concat([head, bytes, Buffer.alloc(bytes.length % 2)]);
  };
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1); format.writeUInt16LE(1, 2);
  format.writeUInt32LE(8000, 4); format.writeUInt32LE(16000, 8);
  format.writeUInt16LE(2, 12); format.writeUInt16LE(16, 14);
  const conflicting = Buffer.from(format);
  conflicting.writeUInt16LE(2, 2); conflicting.writeUInt32LE(16000, 4);
  conflicting.writeUInt32LE(64000, 8); conflicting.writeUInt16LE(4, 12);
  return chunk("RIFF", Buffer.concat([Buffer.from("WAVE"), chunk("fmt ", format),
    ...(duplicate ? [chunk("fmt ", conflicting)] : []),
    chunk("data", Buffer.from([100, 0, 200, 0, 44, 1, 144, 1]))]));
}

for (const duplicate of [false, true]) {
  it(`uses the first WAV format across all readers (duplicate: ${duplicate})`, async () => {
    const bytes = fixture(duplicate);
    const result = await probeWavSource({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } });
    assert.equal(result.streams[0]!.sample_rate, "8000");
    assert.equal(result.streams[0]!.channels, 1);
    assert.equal(Number(result.streams[0]!.duration_ts), 4);
    const packets = wavAst().probe(bytes, { showPackets: true }).packets!;
    assert.equal(Number(packets![0]!.pos), duplicate ? 68 : 44);
    assert.equal(Number(packets![0]!.size), 8);
    assert.equal(packets![0]!.duration, 4);
    assert.deepEqual(wavAst().probe(bytes), result);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData.length, 1);
    assert.deepEqual(Array.from(audio.channelData[0]!), [100, 200, 300, 400].map(value => value / 32768));
    const header = await readWavStreamHeader((async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })());
    assert.equal(header.sampleRate, 8000);
    assert.equal(header.channels, 1);
    assert.equal(header.formatOffset, 20);
  });
}
