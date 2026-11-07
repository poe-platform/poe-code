import assert from "node:assert/strict";
import { it } from "node:test";
import { aiffAst, parseAiff, serializeAiff } from "./containers/aiff.js";

const native = Buffer.from("464f524d0000004041494646434f4d4d000000120001000000090010400bfa0000000000000053534e440000001a00000000000000008000bffffeffffff00000001010140017fff", "hex");

it("probes native AIFF without decoding and copies exact PCM bytes", () => {
  const doc = parseAiff(native, { decodeAudio: false });
  assert.equal(doc.tracks[0]!.decodedAudio, undefined);
  assert.deepEqual(Buffer.from(serializeAiff(doc, { audioCodec: "copy" })), native);
  const result = aiffAst().probe(native);
  assert.equal(result.streams[0]!.codec_name, "pcm_s16be");
  assert.equal(result.streams[0]!.sample_rate, "8000");
  assert.equal(result.streams[0]!.channels, 1);
});

for (const bits of [8, 16, 24, 32]) {
  it(`reads interleaved stereo PCM${bits} and writes its SSND chunk`, () => {
    const bytes = Buffer.alloc(54 + 2 * bits / 8);
    native.copy(bytes, 0, 0, 54);
    bytes.writeUInt32BE(bytes.length - 8, 4);
    bytes.writeUInt16BE(2, 20); bytes.writeUInt32BE(1, 22); bytes.writeUInt16BE(bits, 26);
    bytes.writeUInt32BE(8 + 2 * bits / 8, 42);
    bytes[54] = 0x80; bytes[54 + bits / 8] = 0x40;
    const doc = parseAiff(bytes);
    assert.deepEqual(doc.tracks[0]!.decodedAudio!.channelData.map(channel => [...channel]), [[-1], [0.5]]);
    assert.deepEqual(Buffer.from(serializeAiff(doc, { audioCodec: bits === 8 ? "pcm_s8" : `pcm_s${bits}be` })), bytes);
  });
}

it("accepts unknown padded chunks and SSND offsets", () => {
  const bytes = Buffer.concat([native.subarray(0, 38), Buffer.from("4a554e4b000000017800", "hex"), native.subarray(38, 54), Buffer.from([0, 0]), native.subarray(54)]);
  bytes.writeUInt32BE(bytes.length - 8, 4); bytes.writeUInt32BE(28, 52); bytes.writeUInt32BE(2, 56);
  assert.deepEqual(parseAiff(bytes).tracks[0]!.decodedAudio, parseAiff(native).tracks[0]!.decodedAudio);
});

for (const [name, offset, value] of [
  ["FORM length", 4, 1000], ["COMM length", 16, 1000], ["sample count", 22, 1000],
  ["sound offset", 46, 1000], ["sample rate", 28, 0]
] as const) {
  it(`rejects invalid ${name}`, () => {
    const bytes = Buffer.from(native); bytes.writeUInt32BE(value, offset);
    assert.throws(() => parseAiff(bytes));
  });
}

it("rejects unsupported encoders and enforces decode limits", () => {
  assert.throws(() => serializeAiff(parseAiff(native), { audioCodec: "pcm_s16le" }), /not supported/);
  assert.throws(() => parseAiff(native, { limits: { maxInputBytes: 10 } }));
});

it("pads odd-length PCM8 without counting padding as a sample", () => {
  const doc = parseAiff(native);
  const bytes = Buffer.from(serializeAiff(doc, { audioCodec: "pcm_s8" }));
  assert.equal(bytes.length, 64);
  assert.equal(bytes.readUInt32BE(22), 9);
  assert.equal(bytes.readUInt32BE(42), 17);
  assert.equal(bytes[63], 0);
  assert.equal(parseAiff(bytes).tracks[0]!.decodedAudio!.channelData[0]!.length, 9);
});
