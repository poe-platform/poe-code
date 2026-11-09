import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { auAst } from "./containers/au.js";
import { rawAudioAsts } from "./containers/raw-audio.js";

const input = Buffer.from("2e736e64000000200000000f0000001800001f4000000001000000000000000012345678abcdef0112345678abcdef", "hex");

it("decodes AU encoding 24 as G.722 with native PCM output", () => {
  const doc = auAst().parse(input);
  const pcm = rawAudioAsts().find(ast => ast.id === "s16le")!.serialize(doc);
  assert.equal(pcm.length, 60);
  assert.equal(createHash("sha256").update(pcm).digest("hex"), "ebe3615fd816af723aa75e7ef97fe952958975ca54258f8cd34cfb8c6a13a4ec");
  assert.equal(doc.durationSeconds, 30 / 8000);
});

it("probes G.722 without allocating decoded audio and preserves packets", () => {
  const ast = auAst();
  const doc = ast.parse(input, { decodeAudio: false, limits: { maxMemoryBytes: 0 } });
  assert.equal(doc.tracks[0]!.decodedAudio, undefined);
  assert.deepEqual(doc.tracks[0]!.samples[0]!.data, input.subarray(32));
  assert.equal(doc.tracks[0]!.samples[0]!.offset, 32);
  const stream = ast.probe(input).streams[0]!;
  assert.equal(stream.codec_name, "adpcm_g722");
  assert.equal(stream.sample_rate, "8000");
  assert.equal(stream.channels, 1);
  assert.equal(Number(stream.duration_ts), 30);
});

it("enforces G.722 decode budgets", () => {
  for (const limits of [{ maxMemoryBytes: 119 }, { maxDurationSeconds: 0.001 }, { maxSamplesPerTrack: 0 }]) {
    assert.throws(() => auAst().parse(input, { limits }), /limit/i);
  }
});

for (const [length, hash] of [
  [256, "ba40e5b8881dc5b37c8f4f26017495a16d1aba7deb9352129769812adbdf169d"],
  [8193, "9f535744fbf5f15c91d198c729e796e242a0a97043cfd59daaeb90f83c98590d"]
] as const) {
  it(`matches native G.722 synthesis and adaptation across ${length} codewords`, () => {
    const bytes = Buffer.alloc(32 + length);
    bytes.set(input.subarray(0, 32));
    bytes.writeUInt32BE(length, 8);
    for (let i = 0; i < length; i++) bytes[32 + i] = (i * 73 + (i >> 3) * 19) & 255;
    const pcm = rawAudioAsts().find(ast => ast.id === "s16le")!.serialize(auAst().parse(bytes));
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

for (const size of [0, 4, 30, 0xffffffff]) {
  it(`keeps G.722 payload decoding separate from declared AU size ${size}`, () => {
    const bytes = Buffer.from(input);
    bytes.writeUInt32BE(size, 8);
    const doc = auAst().parse(bytes);
    assert.equal(doc.duration, size === 0xffffffff ? 30 : size * 2);
    assert.equal(doc.tracks[0]!.decodedAudio!.channelData[0]!.length, size === 0 ? 0 : 30);
    assert.equal(auAst().parse(bytes, { decodeAudio: false }).tracks[0]!.samples[0]!.size, 15);
  });
}

it("encodes mono PCM as byte-identical native G.722 AU", () => {
  const raw = rawAudioAsts().find(ast => ast.id === "s16le")!;
  const source = Buffer.alloc(1024);
  for (let i = 0; i < 512; i++) source.writeInt16LE((i * 2003 % 50000) - 25000, i * 2);
  const doc = raw.parse(source, { sampleRate: 16000, channels: 1 });
  const encoded = auAst().serialize(doc, { audioCodec: "g722", audioBitrate: 64000 });
  assert.equal(encoded.length, 288);
  assert.equal(createHash("sha256").update(encoded).digest("hex"), "b73f7ae64ac0a9d4f67b1ad7a6a01fe7a68ba8e77fb57f24a26947b4fe018102");
  const decoded = raw.serialize(auAst().parse(encoded));
  assert.equal(decoded.length, source.length);
  assert.equal(createHash("sha256").update(decoded).digest("hex"), "40659ba2606a14d4b84ce628c677ba28a505730b909d5acae7a8e26e8879e0fb");
});

for (const [length, hash] of [
  [0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  [1, "bbf3f11cb5b43e700273a78d12de55e4a7eab741ed2abf13787a4d2dc832b8ec"],
  [3, "fd1cdd193de46baa318bedc9d442cdb0ef1523f5a08b969759e20318e3e45d80"],
  [513, "a2aa28f854ee0e8c854ca8a076b4432d7b6b286220340b4428d2a86b4239a291"],
  [16385, "0ab26cbe3ef7b817e590b7cd6e6b2e5776d03d158738f4301d304b2e760e066f"]
] as const) {
  it(`matches native G.722 encoding for ${length} samples`, () => {
    const source = Buffer.alloc(length * 2);
    for (let i = 0; i < length; i++) source.writeInt16LE((i * 2003 % 50000) - 25000, i * 2);
    const doc = rawAudioAsts().find(ast => ast.id === "s16le")!.parse(source, { sampleRate: 16000 });
    const bytes = auAst().serialize(doc, { audioCodec: "g722", seekable: false });
    assert.equal(new DataView(bytes.buffer).getUint32(8), 0xffffffff);
    assert.equal(createHash("sha256").update(bytes.subarray(32)).digest("hex"), hash);
  });
}

it("enforces G.722 encode budgets and rejects stereo input", () => {
  const raw = rawAudioAsts().find(ast => ast.id === "s16le")!;
  const doc = raw.parse(new Uint8Array(1024), { sampleRate: 16000 });
  for (const limits of [{ maxMemoryBytes: 255 }, { maxOutputBytes: 287 }, { maxDurationSeconds: 0.001 }]) {
    assert.throws(() => auAst().serialize(doc, { audioCodec: "g722", limits }), /limit/i);
  }
  const stereo = raw.parse(new Uint8Array(1024), { sampleRate: 16000, channels: 2 });
  assert.throws(() => auAst().serialize(stereo, { audioCodec: "g722" }), /mono/);
});
