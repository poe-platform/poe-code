import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { cafAst } from "./containers/caf.js";
import { rawAudioAsts } from "./containers/raw-audio.js";
import { cafIma, cafImaPcmHash } from "./caf-ima-fixture.js";

it("decodes stereo CAF IMA4 with native final-block padding and PCM values", () => {
  const doc = cafAst().parse(cafIma);
  const pcm = rawAudioAsts().find(plugin => plugin.id === "s16le")!.serialize(doc);
  assert.equal(pcm.length, 33024);
  assert.equal(createHash("sha256").update(pcm).digest("hex"), cafImaPcmHash);
});

it("preserves CAF IMA4 packet bytes and timing on stream copy without decoding", () => {
  const ast = cafAst();
  const doc = ast.parse(cafIma, { decodeAudio: false, limits: { maxMemoryBytes: 1 } });
  const track = doc.tracks[0]!;
  assert.equal(track.decodedAudio, undefined);
  assert.equal(doc.duration, 8256);
  assert.equal(track.codecDescriptions[0]!.codecName, "adpcm_ima_qt");
  assert.equal(track.samples.length, 129);
  for (const [index, sample] of track.samples.entries()) {
    assert.equal(sample.duration, 64);
    assert.equal(sample.pts, index * 64);
    assert.equal(sample.size, 68);
    assert.deepEqual(sample.data, cafIma.subarray(sample.offset!, sample.offset! + sample.size));
  }
  const copied = ast.parse(ast.serialize(doc, { audioCodec: "copy" }), { decodeAudio: false });
  assert.deepEqual(copied.tracks[0]!.samples.map(sample => sample.data), track.samples.map(sample => sample.data));
  assert.equal(copied.duration, doc.duration);
});

it("rejects malformed CAF IMA4 dimensions, packet geometry and budget overruns", () => {
  for (const [offset, value] of [[36, 67], [40, 63], [44, 0]]) {
    const bytes = Buffer.from(cafIma);
    bytes.writeUInt32BE(value!, offset!);
    assert.throws(() => cafAst().parse(bytes), /CAF.*encoding/);
  }
  const bytes = Buffer.from(cafIma);
  bytes.writeDoubleBE(NaN, 20);
  assert.throws(() => cafAst().parse(bytes), /sample rate/);
  assert.throws(() => cafAst().parse(cafIma.subarray(0, -1)), /packet/);
  assert.throws(() => cafAst().parse(cafIma, { limits: { maxMemoryBytes: 1 } }), /memory/i);
  assert.throws(() => cafAst().parse(cafIma, { limits: { maxSamplesPerTrack: 128 } }), /limit/i);
});
