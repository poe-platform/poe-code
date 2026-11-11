import assert from "node:assert/strict";
import { it } from "node:test";
import { MediaBudgetTracker } from "./types.js";
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
  ["FORM length", 4, 3], ["COMM length", 16, 1000],
  ["sample rate", 28, 0]
] as const) {
  it(`rejects invalid ${name}`, () => {
    const bytes = Buffer.from(native); bytes.writeUInt32BE(value, offset);
    assert.throws(() => parseAiff(bytes));
  });
}

it("rejects unsupported encoders and enforces decode limits", () => {
  assert.throws(() => serializeAiff(parseAiff(native), { audioCodec: "pcm_s24le" }), /not supported/);
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

// Native FFmpeg: PCM16LE WAV -> -metadata title=Needle -c:a pcm_s16le in.aiff.
const aifc = Buffer.from("464f524d00000058414946434656455200000004a28051404e414d45000000064e6565646c65434f4d4d000000180001000000050010400bfa00000000000000736f7774000053534e440000001200000000000000000080fffe00000101ff7f", "hex");

it("detects and probes native AIFF-C sowt and decodes ordered samples", () => {
  assert.equal(aiffAst().detect(aifc), true);
  const probe = aiffAst().probe(aifc);
  assert.equal(probe.streams[0]!.codec_name, "pcm_s16le");
  assert.equal(probe.streams[0]!.sample_rate, "8000");
  assert.equal(probe.streams[0]!.channels, 1);
  assert.deepEqual(Array.from(parseAiff(aifc).tracks[0]!.decodedAudio!.channelData[0]!, value => value * 32768),
    [-32768, -257, 0, 257, 32767]);
});

it("rejects unknown AIFF-C compression and missing compression tags", () => {
  const unknown = Buffer.from(aifc);
  unknown.write("zzzz", 64);
  assert.throws(() => parseAiff(unknown), /Unsupported AIFF-C compression/);
  const truncated = Buffer.from(aifc);
  truncated.writeUInt32BE(18, 42);
  assert.throws(() => parseAiff(truncated), /Invalid AIFF COMM/);
});

it("reads AIFF-C NONE samples as big-endian PCM", () => {
  const bytes = Buffer.from(aifc);
  bytes.write("NONE", 64);
  bytes.subarray(86).swap16();
  assert.deepEqual(parseAiff(bytes).tracks[0]!.decodedAudio, parseAiff(aifc).tracks[0]!.decodedAudio);
  assert.equal(aiffAst().probe(bytes).streams[0]!.codec_name, "pcm_s16be");
});

for (const copy of [false, true]) {
  it(`writes AIFF-C sowt with exact PCM16LE bytes (${copy ? "copy" : "encode"})`, () => {
    const doc = { ...parseAiff(aifc, { decodeAudio: !copy }), metadata: {} };
    const bytes = Buffer.from(serializeAiff(doc, { audioCodec: copy ? "copy" : "pcm_s16le" }));
    // Native fixture without its optional NAME metadata chunk.
    const expected = Buffer.concat([aifc.subarray(0, 24), aifc.subarray(38)]);
    expected.writeUInt32BE(expected.length - 8, 4);
    assert.deepEqual(bytes, expected);
    assert.ok(aiffAst().supportedAudioCodecs.includes("pcm_s16le"));
    assert.throws(() => serializeAiff(doc, {
      audioCodec: copy ? "copy" : "pcm_s16le",
      budget: new MediaBudgetTracker({ maxOutputBytes: bytes.length - 1 })
    }), /limit/i);
  });
}

for (const frames of [0, 2, 4, 6]) {
  for (const offset of [0, 2]) {
    it(`decodes available AIFF samples with ${frames} declared frames and offset ${offset}`, () => {
      const bytes = Buffer.concat([native.subarray(0, 54), Buffer.alloc(offset), Buffer.from("0064ff38012cfe70", "hex")]);
      bytes.writeUInt32BE(bytes.length - 8, 4);
      bytes.writeUInt32BE(frames, 22);
      bytes.writeUInt32BE(16 + offset, 42);
      bytes.writeUInt32BE(offset, 46);
      for (const decodeAudio of [true, false]) {
        const doc = parseAiff(bytes, { decodeAudio });
        assert.equal(doc.duration, frames);
        assert.equal(doc.durationSeconds, frames / 8000);
        assert.equal(doc.tracks[0]!.duration, frames);
        assert.equal(doc.tracks[0]!.samples.reduce((sum, sample) => sum + sample.data.length, 0), 8);
        if (decodeAudio) assert.deepEqual(Array.from(doc.tracks[0]!.decodedAudio!.channelData[0]!, value => value * 32768), [100, -200, 300, -400]);
      }
    });
  }
}

for (const seekable of [undefined, true, false]) {
  it(`writes AIFF size placeholders only when seekable is ${seekable}`, () => {
    const expected = Buffer.from(native);
    if (seekable === false) {
      for (const offset of [4, 22, 42]) expected.writeUInt32BE(0, offset);
    }
    assert.deepEqual(Buffer.from(serializeAiff(parseAiff(native), { seekable })), expected);
  });
}
