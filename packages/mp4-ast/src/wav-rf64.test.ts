import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, wavAst } from "./index.js";
import { readWavHeader, readWavSourceHeader, readWavStreamHeader } from "./containers/wav-header.js";

function fixture() {
  const bytes = Buffer.alloc(80 + 4096 + 10);
  bytes.write("RF64"); bytes.writeUInt32LE(0xffffffff, 4); bytes.write("WAVEds64", 8);
  bytes.writeUInt32LE(28, 16); bytes.writeBigUInt64LE(BigInt(bytes.length - 8), 20);
  bytes.writeBigUInt64LE(4096n, 28); bytes.writeBigUInt64LE(1024n, 36);
  bytes.write("fmt ", 48); bytes.writeUInt32LE(16, 52);
  bytes.writeUInt16LE(1, 56); bytes.writeUInt16LE(2, 58);
  bytes.writeUInt32LE(8000, 60); bytes.writeUInt32LE(32000, 64);
  bytes.writeUInt16LE(4, 68); bytes.writeUInt16LE(16, 70);
  bytes.write("data", 72); bytes.writeUInt32LE(0xffffffff, 76);
  const samples = [-32768, 32767, -12345, 23456, -1, 0, 1, 256];
  for (let i = 0; i < 2048; i++) bytes.writeInt16LE(samples[i % samples.length]!, 80 + i * 2);
  bytes.write("JUNK", 4176); bytes.writeUInt32LE(1, 4180); bytes[4184] = 123;
  return bytes;
}

it("detects RF64 and decodes only ds64's PCM extent, excluding trailing chunks", async () => {
  const bytes = fixture();
  assert.equal(wavAst().detect(bytes), true);
  const header = readWavHeader(bytes);
  assert.equal(header.dataSize, 4096);
  assert.equal(header.declaredDataSize, 4096);
  assert.deepEqual(await readWavSourceHeader({ size: bytes.length,
    read: async (offset, length) => bytes.subarray(offset, offset + Math.min(length, 3)) }), header);
  assert.deepEqual(await readWavStreamHeader((async function* () {
    for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
  })()), header);
  const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 8000);
  assert.equal(audio.channelData.length, 2);
  for (let channel = 0; channel < 2; channel++) {
    assert.equal(audio.channelData[channel]!.length, 1024);
    assert.deepEqual(Array.from(audio.channelData[channel]!, value => Math.round(value * 32768)),
      Array.from({ length: 1024 }, (_, frame) => bytes.readInt16LE(80 + frame * 4 + channel * 2)));
  }
});

for (const [name, mutate] of [
  ["missing ds64", (bytes: Buffer) => { bytes.write("JUNK", 12); }],
  ["short ds64", (bytes: Buffer) => { bytes.writeUInt32LE(20, 16); }],
  ["truncated table", (bytes: Buffer) => { bytes.writeUInt32LE(1, 44); }],
  ["unsafe RIFF size", (bytes: Buffer) => { bytes.writeBigUInt64LE(2n ** 60n, 20); }],
  ["unsafe data size", (bytes: Buffer) => { bytes.writeBigUInt64LE(2n ** 60n, 28); }],
  ["out-of-bounds data", (bytes: Buffer) => { bytes.writeBigUInt64LE(99999n, 28); }],
  ["out-of-bounds RIFF", (bytes: Buffer) => { bytes.writeBigUInt64LE(99999n, 20); }]
] as const) {
  it(`rejects RF64 ${name}`, async () => {
    const bytes = fixture(); mutate(bytes);
    assert.throws(() => readWavHeader(bytes), /RF64/);
    await assert.rejects(readWavSourceHeader({ size: bytes.length,
      read: async (offset, length) => bytes.subarray(offset, offset + length) }), /RF64/);
    await assert.rejects(readWavStreamHeader((async function* () { yield bytes; })()), /RF64/);
  });
}

it("resolves ds64 table sizes for sentinel chunks and preserves odd padding", async () => {
  const original = fixture();
  const bytes = Buffer.concat([original.subarray(0, 48), Buffer.alloc(12), original.subarray(48)]);
  bytes.writeUInt32LE(40, 16); bytes.writeBigUInt64LE(BigInt(bytes.length - 8), 20);
  bytes.writeUInt32LE(1, 44); bytes.write("JUNK", 48); bytes.writeBigUInt64LE(1n, 52);
  bytes.writeUInt32LE(0xffffffff, 4192);
  const expected = readWavHeader(bytes);
  assert.equal(expected.dataSize, 4096);
  assert.deepEqual(await readWavStreamHeader((async function* () { yield bytes; })()), expected);
  bytes.write("MISS", 48);
  assert.throws(() => readWavHeader(bytes), /Missing RF64 chunk size/);
});

it("probes an RF64 source larger than 4 GiB without reading PCM payloads", async () => {
  const bytes = fixture().subarray(0, 80);
  const dataSize = 2 ** 32 + 4096, size = 80 + dataSize;
  bytes.writeBigUInt64LE(BigInt(size - 8), 20); bytes.writeBigUInt64LE(BigInt(dataSize), 28);
  bytes.writeBigUInt64LE(BigInt(dataSize / 4), 36);
  const header = await readWavSourceHeader({ size, async read(offset, length) {
    assert.ok(offset + length <= 80, "must not read PCM payload");
    return bytes.subarray(offset, offset + length);
  }});
  assert.equal(header.dataSize, dataSize);
  assert.equal(header.byteLength, size);
});
