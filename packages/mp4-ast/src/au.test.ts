import assert from "node:assert/strict";
import { it } from "node:test";
import { auAst } from "./containers/au.js";

const native = Buffer.from("2e736e6400000020000000120000000300001f400000000100000000000000008000bffffeffffff00000001010140017fff", "hex");

it("reads annotations, unknown data length, and preserves encoded packets for copy", () => {
  const bytes = Buffer.from(native);
  bytes.writeUInt32BE(0xffffffff, 8);
  const ast = auAst();
  const doc = ast.parse(bytes, { decodeAudio: false });
  assert.equal(doc.tracks[0]!.decodedAudio, undefined);
  assert.equal(doc.durationSeconds, 9 / 8000);
  assert.deepEqual(ast.serialize(doc, { audioCodec: "copy" }), new Uint8Array(native));
  const probe = ast.probe(bytes);
  assert.equal(probe.streams[0]!.codec_name, "pcm_s16be");
  assert.equal(probe.streams[0]!.sample_rate, "8000");
});

it("rejects truncated headers, invalid bounds, unsupported encodings and incomplete frames", () => {
  const ast = auAst();
  assert.throws(() => ast.parse(native.subarray(0, 23)), /header/);
  for (const [offset, value, error] of [
    [4, 23, /bounds/], [4, 100, /bounds/], [8, 100, /bounds/],
    [12, 99, /encoding/], [16, 0, /sample rate/], [20, 0, /channel count/],
    [8, 17, /sample frame/]
  ] as const) {
    const bytes = Buffer.from(native);
    bytes.writeUInt32BE(value, offset);
    assert.throws(() => ast.parse(bytes), error);
  }
  assert.throws(() => ast.parse(native, { limits: { maxInputBytes: 40 } }), /limit/i);
  assert.throws(() => ast.serialize(ast.parse(native), { audioCodec: "pcm_s16le" }), /Unsupported AU/);
});
