import assert from "node:assert/strict";
import { it } from "node:test";
import { aiffAst, parseAiff, serializeAiff } from "./containers/aiff.js";

// Native FFmpeg AIFF; ffprobe reports a zero codec tag because COMM has no FourCC.
const bytes = Buffer.from("464f524d0000003841494646434f4d4d000000120001000000050010400bfa0000000000000053534e44000000120000000000000000000bff2b0bb80001fff7", "hex");

for (const bits of [8, 16, 24, 32]) {
  it(`reports no container codec tag for ordinary PCM${bits} AIFF`, () => {
    const input = bits === 16 ? bytes : serializeAiff(parseAiff(bytes), {
      audioCodec: bits === 8 ? "pcm_s8" : `pcm_s${bits}be`
    });
    for (const decodeAudio of [false, true]) {
      const doc = parseAiff(input, { decodeAudio });
      assert.equal(doc.tracks[0]!.codecDescriptions[0]!.formatFourCC, "\0\0\0\0");
      assert.deepEqual(serializeAiff(doc, { audioCodec: "copy" }), new Uint8Array(input));
    }
    const stream = aiffAst().probe(input).streams[0]!;
    assert.equal(stream.codec_name, bits === 8 ? "pcm_s8" : `pcm_s${bits}be`);
    assert.equal(stream.codec_tag_string, "[0][0][0][0]");
    assert.equal(stream.codec_tag, "0x0000");
  });
}

it("preserves the declared ima4 codec tag for AIFF-C", () => {
  const aifc = serializeAiff(parseAiff(bytes), { audioCodec: "adpcm_ima_qt" });
  const stream = aiffAst().probe(aifc).streams[0]!;
  assert.equal(stream.codec_name, "adpcm_ima_qt");
  assert.equal(stream.codec_tag_string, "ima4");
  assert.equal(stream.codec_tag, "0x34616d69");
});
