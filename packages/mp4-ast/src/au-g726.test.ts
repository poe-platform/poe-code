import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { auAst } from "./containers/au.js";
import { rawAudioAsts } from "./containers/raw-audio.js";

const cases = [
  [23, 4, 30, "a8002983dba56c496c1b5dc08db95655dfb2ed71e06d206295ab1ccc8ae69d59"],
  [25, 3, 40, "19e12db301bc6628a3e0956e2bb36c88f470b1ecee029f2fba4a349204933aa2"],
  [26, 5, 24, "a111e21122712ace62896c65692f8b9b7b7f6579cb00cbf39dd6bca9472a2755"]
] as const;

function fixture(encoding: number) {
  const bytes = Buffer.alloc(47);
  [0x2e736e64, 32, 15, encoding, 8000, 1].forEach((value, i) => bytes.writeUInt32BE(value, i * 4));
  bytes.set(Buffer.from("12345678abcdef0112345678abcdef", "hex"), 32);
  return bytes;
}

for (const [encoding, hash] of [
  [23, "7c667ebf9b2d4d7978c09f9ec4fddb1fb64926dbd47b8b479b24c60c6e6f2907"],
  [25, "afac934e18decc9398f2e094918de5b19788f5777f8b3b623b45dbe62ef284fb"],
  [26, "978c990d0ff664001178bf6ecfca73f24eeaf9746ddcc06690b4b09e402fcff5"]
] as const) {
  it(`matches native AU ${encoding} predictor adaptation over 8190 encoded bytes`, () => {
    const bytes = Buffer.alloc(32 + 8190);
    bytes.set(fixture(encoding).subarray(0, 32));
    bytes.writeUInt32BE(8190, 8);
    for (let i = 0; i < 8190; i++) bytes[32 + i] = (i * 73 + Math.floor(i / 7)) % 256;
    const doc = auAst().parse(bytes);
    const pcm = rawAudioAsts().find(plugin => plugin.id === "s16le")!.serialize(doc);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

it("retains declared AU duration and rejects unsupported G.726 channel counts when decoding", () => {
  const bytes = fixture(25);
  bytes.writeUInt32BE(0, 8);
  assert.equal(auAst().parse(bytes).tracks[0]!.decodedAudio!.channelData[0]!.length, 0);
  bytes.writeUInt32BE(0xffffffff, 8);
  assert.equal(auAst().parse(bytes).duration, 40);
  bytes.writeUInt32BE(2, 20);
  assert.throws(() => auAst().parse(bytes), /mono/);
  assert.equal(auAst().probe(bytes).streams[0]!.channels, 2);
});

for (const [encoding, bits, frames, hash] of cases) {
  it(`decodes AU ${encoding} as ${bits}-bit little-endian G.726 matching native PCM`, () => {
    const bytes = fixture(encoding);
    const ast = auAst();
    const doc = ast.parse(bytes);
    assert.equal(doc.tracks[0]!.decodedAudio!.channelData[0]!.length, frames);
    const pcm = rawAudioAsts().find(plugin => plugin.id === "s16le")!.serialize(doc);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    const probe = ast.probe(bytes);
    assert.equal(probe.streams[0]!.codec_name, "adpcm_g726le");
    assert.equal(doc.tracks[0]!.codecDescriptions[0]!.bitsPerSample, bits);
    assert.equal(Number(probe.streams[0]!.duration_ts), frames);
    const encoded = ast.parse(bytes, { decodeAudio: false });
    assert.equal(encoded.tracks[0]!.decodedAudio, undefined);
    assert.deepEqual(encoded.tracks[0]!.samples[0]!.data, bytes.subarray(32));
    assert.equal(encoded.tracks[0]!.samples[0]!.offset, 32);
    assert.throws(() => ast.parse(bytes, { limits: { maxMemoryBytes: 1 } }), /limit/i);
  });
}
