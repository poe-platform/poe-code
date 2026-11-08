import assert from "node:assert/strict";
import { it } from "node:test";
import { MediaBudgetTracker } from "./types.js";
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

it("reads native title and artist annotations and writes aligned UTF-8 metadata", () => {
  const ast = auAst();
  const tagged = Buffer.from("2e736e6400000038ffffffff0000000300001f40000000015469746c653d4e6565646c650a4172746973743d5465737465720000000000008000feff000001017fff", "hex");
  const doc = ast.parse(tagged);
  assert.equal(doc.metadata.title, "Needle");
  assert.equal(doc.metadata.artist, "Tester");
  assert.equal(ast.probe(tagged).format.tags?.title, "Needle");
  const output = ast.serialize(doc, { metadata: { title: "Renée=一", artist: "Tester" } });
  const offset = new DataView(output.buffer).getUint32(4);
  assert.equal(offset % 8, 0);
  assert.equal(ast.parse(output).metadata.title, "Renée=一");
  assert.deepEqual(output.subarray(offset), new Uint8Array(tagged.subarray(56)));
  const stripped = ast.serialize(doc, { metadata: {} });
  assert.equal(new DataView(stripped.buffer).getUint32(4), 32);
  assert.deepEqual(ast.parse(stripped).metadata, {});
  assert.throws(() => ast.serialize(doc, { budget: new MediaBudgetTracker({ maxOutputBytes: 50 }) }), /limit/i);
});
