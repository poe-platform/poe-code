import assert from "node:assert/strict";
import { it } from "node:test";
import { cafAst } from "./containers/caf.js";

// Native FFmpeg output from independently generated Python wave PCM16 samples.
const native = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000020000000100000001000000106368616e000000000000000c006400010000000000000000696e666f000000000000001900000001656e636f646572004c61766636332e312e31303100646174610000000000000016000000008000bffffeffffff00000001010140017fff", "hex");

it("reads native CAF metadata chunks and unknown data size without decoding for probe/copy", () => {
  const ast = cafAst();
  const bytes = Buffer.from(native);
  bytes.writeBigInt64BE(-1n, bytes.length - 30);
  const doc = ast.parse(bytes, { decodeAudio: false });
  assert.equal(doc.tracks[0]!.decodedAudio, undefined);
  assert.equal(doc.durationSeconds, 9 / 8000);
  assert.deepEqual(ast.serialize(doc, { audioCodec: "copy" }).subarray(68), new Uint8Array(native.subarray(-18)));
  const probe = ast.probe(bytes);
  assert.equal(probe.streams[0]!.codec_name, "pcm_s16be");
  assert.equal(probe.streams[0]!.sample_rate, "8000");
  assert.equal(probe.streams[0]!.channels, 1);
});

it("rejects malformed CAF dimensions, chunks, encodings, and budget overruns", () => {
  const ast = cafAst();
  assert.throws(() => ast.parse(native.subarray(0, 7)), /header/);
  assert.throws(() => ast.parse(native.subarray(0, 15)), /chunk header/);
  assert.throws(() => ast.parse(native.subarray(0, native.length - 1)), /bounds/);
  for (const [offset, value] of [[28, 0], [32, 4], [36, 3], [40, 2], [44, 0], [48, 12]]) {
    const bytes = Buffer.from(native);
    bytes.writeUInt32BE(value!, offset!);
    assert.throws(() => ast.parse(bytes), /encoding/);
  }
  const bytes = Buffer.from(native);
  bytes.writeDoubleBE(NaN, 20);
  assert.throws(() => ast.parse(bytes), /sample rate/);
  bytes.writeBigInt64BE(-2n, 12);
  assert.throws(() => ast.parse(bytes), /bounds/);
  assert.throws(() => ast.parse(native, { limits: { maxInputBytes: 40 } }), /limit/i);
  assert.throws(() => ast.serialize(ast.parse(native), { audioCodec: "aac" }), /Unsupported CAF/);
});
