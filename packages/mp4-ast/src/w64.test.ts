import assert from "node:assert/strict";
import { it } from "node:test";
import { wavAst, parseWav } from "./containers/adapters.js";
import { readWavHeader, readWavSourceHeader, readWavStreamHeader } from "./containers/wav-header.js";

// Native FFmpeg output includes six alignment bytes in the data chunk size.
const native = Buffer.from("726966662e91cf11a5d628db04c10000800000000000000077617665f3acd3118cd100c04f8edb8a666d7420f3acd3118cd100c04f8edb8a280000000000000001000100401f0000803e00000200100064617461f3acd3118cd100c04f8edb8a30000000000000000080ffbffffeffff0000010001010140ff7f000000000000", "hex");

it("probes Wave64 and preserves encoded samples for stream copy", async () => {
  const ast = wavAst("w64");
  const doc = ast.parse(native, { decodeAudio: false });
  assert.equal(doc.containerFormat, "w64");
  assert.equal(doc.tracks[0]!.decodedAudio, undefined);
  assert.deepEqual(ast.serialize(doc, { audioCodec: "copy" }), new Uint8Array(native));
  const probe = ast.probe(native);
  assert.equal(probe.format.format_name, "w64");
  assert.equal(probe.streams[0]!.codec_name, "pcm_s16le");
  assert.equal(probe.streams[0]!.sample_rate, "8000");
  const header = readWavHeader(native);
  assert.deepEqual(await readWavSourceHeader({ size: native.length, async read(offset, length) {
    return native.subarray(offset, offset + Math.min(length, 3));
  } }), header);
  assert.deepEqual(await readWavStreamHeader((async function* () {
    for (const byte of native) yield Uint8Array.of(byte);
  })()), header);
});

it("aligns Wave64 fmt, fact, and data chunks without adding audio samples", () => {
  const ast = wavAst("w64");
  const input = Buffer.from(native);
  input.writeBigUInt64LE(42n, 96); // Nine samples, with padding outside the data chunk.
  for (const codec of ["pcm_s16le", "pcm_u8", "pcm_f32le", "pcm_mulaw"]) {
    const bytes = ast.serialize(ast.parse(input), { audioCodec: codec });
    const header = readWavHeader(bytes);
    assert.equal(header.dataOffset % 8, 0);
    assert.equal(bytes.length % 8, 0);
    assert.equal(parseWav(bytes).tracks[0]!.decodedAudio!.channelData[0]!.length, 9);
    assert.equal(ast.probe(bytes).streams[0]!.codec_name, codec);
  }
});

it("rejects invalid Wave64 GUIDs, sizes and missing required chunks", () => {
  const ast = wavAst("w64");
  assert.throws(() => ast.parse(native.subarray(0, 39)), /Wave64/);
  for (const [offset, value] of [[16, 39n], [16, 129n], [16, 2n ** 60n], [56, 23n], [96, 100n]] as const) {
    const bytes = Buffer.from(native);
    bytes.writeBigUInt64LE(value, offset);
    assert.throws(() => ast.parse(bytes), /Wave64/);
  }
  for (const offset of [4, 28, 44, 84]) {
    const bytes = Buffer.from(native);
    bytes[offset] = 0;
    assert.throws(() => ast.parse(bytes), /Wave64/);
  }
});
