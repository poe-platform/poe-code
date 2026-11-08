import assert from "node:assert/strict";
import { it } from "node:test";
import { aiffAst, parseAiff, serializeAiff } from "./containers/aiff.js";

for (let bits = 1; bits <= 32; bits++) {
  it(`reads ${bits}-bit AIFF using whole-byte signed PCM storage`, () => {
    const storageBits = Math.ceil(bits / 8) * 8;
    const bytes = Buffer.from("464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e44000000100000000000000000" + "40102030c0e0a09037280d2480ca0250".slice(0, storageBits), "hex");
    bytes.writeUInt32BE(bytes.length - 8, 4);
    bytes.writeUInt16BE(bits, 26);
    bytes.writeUInt32BE(bytes.length - 46, 42);
    const expected = Buffer.from(bytes);
    expected.writeUInt16BE(storageBits, 26);
    assert.deepEqual(parseAiff(bytes).tracks[0]!.decodedAudio, parseAiff(expected).tracks[0]!.decodedAudio);
    assert.equal(aiffAst().probe(bytes).streams[0]!.codec_name, storageBits === 8 ? "pcm_s8" : `pcm_s${storageBits}be`);
    assert.deepEqual(Buffer.from(serializeAiff(parseAiff(bytes, { decodeAudio: false }), { audioCodec: "copy" })), expected);
  });
}

for (const bits of [0, 33, 65535]) {
  it(`rejects unsupported AIFF sample width ${bits}`, () => {
    const bytes = Buffer.from("464f524d0000003041494646434f4d4d000000120001000000010010400bfa0000000000000053534e440000000a00000000000000004010", "hex");
    bytes.writeUInt16BE(bits, 26);
    assert.throws(() => parseAiff(bytes), /unsupported AIFF audio format/);
  });
}
