import assert from "node:assert/strict";
import { it } from "node:test";
import { MediaBudgetTracker } from "./types.js";
import { cafAst } from "./containers/caf.js";

// Native FFmpeg output from independently generated Python wave PCM16 samples.
const native = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000020000000100000001000000106368616e000000000000000c006400010000000000000000696e666f000000000000001900000001656e636f646572004c61766636332e312e31303100646174610000000000000016000000008000bffffeffffff00000001010140017fff", "hex");

it("omits empty CAF metadata entries", () => {
  const ast = cafAst();
  const doc = ast.parse(native);
  const output = ast.serialize(doc, {
    audioCodec: "copy", metadata: { title: "", artist: "", encoder: "" }
  });
  assert.deepEqual(ast.parse(output).metadata, {});
  assert.deepEqual(output.subarray(-18), new Uint8Array(native.subarray(-18)));
});

for (const flags of [0, 2]) {
  it(`preserves PCM signedness and byte order with the signed-integer flag (${flags})`, () => {
    const ast = cafAst();
    const control = Buffer.from(native);
    control.writeUInt32BE(flags, 32);
    const explicit = Buffer.from(control);
    explicit.writeUInt32BE(flags | 4, 32);
    assert.deepEqual(ast.parse(explicit), ast.parse(control));
    assert.deepEqual(ast.probe(explicit), ast.probe(control));
    assert.equal(ast.probe(explicit).streams[0]!.codec_name, flags === 0 ? "pcm_s16be" : "pcm_s16le");
  });
}

it("requires the description first but permits unknown chunks after it", () => {
  const ast = cafAst();
  const header = native.subarray(0, 8);
  const description = native.subarray(8, 52);
  const data = native.subarray(-34);
  const free = Buffer.from("667265650000000000000000", "hex");
  for (const bytes of [
    Buffer.concat([header, data, description]),
    Buffer.concat([header, free, description, data])
  ]) {
    assert.throws(() => ast.parse(bytes), /CAF description must be the first chunk/);
    assert.throws(() => ast.probe(bytes), /CAF description must be the first chunk/);
  }
  const valid = Buffer.concat([header, description, free, data]);
  const expected = ast.parse(native).tracks[0]!;
  assert.deepEqual(ast.parse(valid).tracks, [{ ...expected,
    codecDescriptions: expected.codecDescriptions.map(desc => ({ ...desc, channelLayout: undefined })),
    samples: expected.samples.map(sample => ({ ...sample, offset: 80 }))
  }]);
  assert.equal(ast.probe(valid).streams[0]!.codec_name, "pcm_s16be");
});

it("reads native CAF metadata chunks and unknown data size without decoding for probe/copy", () => {
  const ast = cafAst();
  const bytes = Buffer.from(native);
  bytes.writeBigInt64BE(-1n, bytes.length - 30);
  const doc = ast.parse(bytes, { decodeAudio: false });
  assert.equal(doc.tracks[0]!.decodedAudio, undefined);
  assert.equal(doc.durationSeconds, 9 / 8000);
  assert.deepEqual(ast.serialize(doc, { audioCodec: "copy" }).subarray(-18), new Uint8Array(native.subarray(-18)));
  const probe = ast.probe(bytes);
  assert.equal(probe.streams[0]!.codec_name, "pcm_s16be");
  assert.equal(probe.streams[0]!.sample_rate, "8000");
  assert.equal(probe.streams[0]!.channels, 1);
  assert.equal(probe.format.tags?.encoder, "Lavf63.1.101");
});

it("rejects malformed CAF dimensions, chunks, encodings, and budget overruns", () => {
  const ast = cafAst();
  assert.throws(() => ast.parse(native.subarray(0, 7)), /header/);
  assert.throws(() => ast.parse(native.subarray(0, 15)), /chunk header/);
  assert.throws(() => ast.parse(native.subarray(0, 51)), /bounds/);
  for (const [offset, value] of [[28, 0], [32, 8], [36, 3], [40, 2], [44, 0], [48, 12]]) {
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

it("round-trips UTF-8 CAF tags, probes them, and honors metadata replacement", () => {
  const ast = cafAst();
  const doc = ast.parse(native, { decodeAudio: false });
  const metadata = { title: "針 🎵", artist: "Tester", album: "Record", comment: "Note 🎵", encoder: "Lavf61.7.100" };
  const bytes = ast.serialize(doc, { audioCodec: "copy", metadata });
  assert.deepEqual(ast.parse(bytes).metadata, metadata);
  assert.equal(ast.probe(bytes).format.tags?.title, metadata.title);
  const cleared = ast.serialize(ast.parse(bytes), { audioCodec: "copy", metadata: {} });
  assert.deepEqual(ast.parse(cleared).metadata, {});
  assert.deepEqual(cleared.subarray(-18), new Uint8Array(native.subarray(-18)));
  assert.throws(() => ast.serialize(doc, { audioCodec: "copy", metadata: { title: "bad\0value" } }), /null bytes/);
});

it("rejects truncated CAF info counts and strings within the chunk bounds", () => {
  const ast = cafAst();
  const bytes = Buffer.from(ast.serialize(ast.parse(native), { metadata: { title: "Needle" } }));
  bytes.writeBigInt64BE(3n, 56);
  assert.throws(() => ast.parse(bytes), /info chunk/);
  bytes.writeBigInt64BE(17n, 56);
  bytes.writeUInt32BE(2, 64);
  assert.throws(() => ast.parse(bytes), /info entry/);
  bytes.writeUInt32BE(1, 64);
  bytes[80] = 1;
  assert.throws(() => ast.parse(bytes), /info entry/);
});

// Complete four-frame LPCM payload; only the declared data length varies.
it("bounds CAF data recovery to EOF and retains strict non-data validation", () => {
  const ast = cafAst();
  const bytes = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d000000000000000200000001000000010000001064617461000000000000000c000000000064ff38012cfe70", "hex");
  const expected = ast.parse(bytes);
  for (const length of [12n, 20n, -1n, 0x7fffffffffffffffn]) {
    bytes.writeBigInt64BE(length, 56);
    assert.deepEqual(ast.parse(bytes), expected);
    assert.equal(ast.probe(bytes).streams[0]!.duration_ts, 4);
  }
  bytes.writeBigInt64BE(-2n, 56);
  assert.throws(() => ast.parse(bytes), /bounds/);
  bytes.writeBigInt64BE(20n, 56);
  assert.throws(() => ast.parse(bytes.subarray(0, 67)), /data chunk/);
  bytes.writeUInt32BE(0x66726565, 52);
  assert.throws(() => ast.parse(bytes), /bounds/);
  bytes.writeBigInt64BE(100n, 12);
  assert.throws(() => ast.probe(bytes), /bounds/);
});

it("retains known CAF layouts, including native quad(side), within the output budget", () => {
  const ast = cafAst();
  for (const [channels, tag, layout] of [
    [1, 0x00640001, "mono"], [2, 0x00650002, "stereo"],
    [4, 0x006c0004, "quad(side)"], [4, 0x00840004, "quad(side)"]
  ] as const) {
    const input = Buffer.from(native);
    input.writeUInt32BE(channels * 2, 36);
    input.writeUInt32BE(channels, 44);
    input.writeUInt32BE(tag, 64);
    const doc = ast.parse(input, { decodeAudio: false });
    const output = ast.serialize(doc, { audioCodec: "copy" });
    assert.equal(ast.probe(output).streams[0]!.channel_layout, layout);
    assert.deepEqual(output.subarray(-18), new Uint8Array(native.subarray(-18)));
    assert.throws(() => ast.serialize(doc, {
      audioCodec: "copy", budget: new MediaBudgetTracker({ maxOutputBytes: output.length - 1 })
    }), /limit/i);
    assert.equal(ast.serialize(doc, {
      audioCodec: "copy", budget: new MediaBudgetTracker({ maxOutputBytes: output.length })
    }).length, output.length);
  }
});

for (let length = 1; length < 12; length++) {
  it(`ignores a ${length}-byte incomplete CAF header only after data`, () => {
    const ast = cafAst();
    const tail = Buffer.from("667265650000000000000003", "hex").subarray(0, length);
    const trailing = Buffer.concat([native, tail]);
    const duration = 9 + Math.round(length / 2);
    assert.deepEqual(ast.parse(trailing).tracks, ast.parse(native).tracks.map(track => ({ ...track, duration })));
    assert.deepEqual(ast.probe(trailing).streams, ast.probe(native).streams.map(stream => ({
      ...stream, duration_ts: duration, duration: (duration / 8000).toFixed(6),
      bit_rate: String(Math.round(18 * 8 * 8000 / duration))
    })));
    const beforeData = Buffer.concat([native.subarray(0, 52), tail]);
    assert.throws(() => ast.parse(beforeData), /Truncated CAF chunk header/);
    assert.throws(() => ast.probe(beforeData), /Truncated CAF chunk header/);
  });
}
