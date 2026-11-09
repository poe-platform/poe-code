import assert from "node:assert/strict";
import { it } from "node:test";
import { ircamAst } from "./containers/ircam.js";

function fixture() {
  const bytes = Buffer.alloc(1088);
  Buffer.from("64a301000000fa450200000002000000", "hex").copy(bytes);
  return bytes;
}

it("probes IRCAM sample rate, channels, duration and packet offsets without decoding", () => {
  const ast = ircamAst();
  const bytes = fixture();
  const doc = ast.parse(bytes, { decodeAudio: false });
  assert.equal(doc.tracks[0]!.decodedAudio, undefined);
  assert.equal(doc.tracks[0]!.samples[0]!.offset, 1024);
  const probe = ast.probe(bytes);
  assert.equal(probe.format.format_name, "ircam");
  assert.equal(probe.streams[0]!.codec_name, "pcm_s16le");
  assert.equal(probe.streams[0]!.sample_rate, "8000");
  assert.equal(probe.streams[0]!.channels, 2);
  assert.equal(doc.durationSeconds, 16 / 8000);
});

it("rejects truncated IRCAM headers, invalid audio parameters and unsupported encodings", () => {
  const ast = ircamAst();
  assert.throws(() => ast.parse(fixture().subarray(0, 1023)), /header/);
  for (const value of [0, -1, NaN, Infinity]) {
    const bytes = fixture();
    bytes.writeFloatLE(value, 4);
    assert.throws(() => ast.parse(bytes), /sample rate/);
  }
  for (const value of [0, 65536]) {
    const bytes = fixture();
    bytes.writeUInt32LE(value, 8);
    assert.throws(() => ast.parse(bytes), /channel count/);
  }
  const bytes = fixture();
  bytes.writeUInt32LE(0xffffffff, 12);
  assert.throws(() => ast.parse(bytes), /encoding/);
});

it("applies input, memory and duration limits to IRCAM decoding", () => {
  const ast = ircamAst();
  for (const limits of [{ maxInputBytes: 1087 }, { maxMemoryBytes: 1 }, { maxDurationSeconds: 0.001 }]) {
    assert.throws(() => ast.parse(fixture(), { limits }), /limit/i);
  }
});
