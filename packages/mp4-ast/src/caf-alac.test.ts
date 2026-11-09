import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { cafAst } from "./containers/caf.js";
import { rawAudioAsts } from "./containers/raw-audio.js";
import { serializeMp4 } from "./mp4.js";
import { cafAlac } from "./caf-alac-fixture.js";

const hash = "50d5595b384041baf4e0d17bef38434d327019e750cd522c87b3cf80a6fc41bf";
it("reads every variable ALAC packet and decodes the short final frame", () => {
  const doc = cafAst().parse(cafAlac);
  assert.deepEqual(doc.tracks[0]!.samples.map(s => s.size), [2267, 7676, 40]);
  const pcm = rawAudioAsts().find(p => p.id === "s16le")!.serialize(doc);
  assert.equal(pcm.length, 32800);
  assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
});
for (const format of ["caf", "mov"] as const) it(`copies CAF ALAC into ${format} with native-decodable configuration`, () => {
  const doc = cafAst().parse(cafAlac, { decodeAudio: false });
  assert.equal(doc.tracks[0]!.decodedAudio, undefined);
  const bytes = format === "caf" ? cafAst().serialize(doc, { audioCodec: "copy" })
    : serializeMp4(doc, { format, audioCodec: "copy" });
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"], { input: bytes });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stdout.length, 32800);
  assert.equal(createHash("sha256").update(result.stdout).digest("hex"), hash);
});

it("rejects missing configuration, truncated packet tables, invalid packet sizes and exhausted budgets", () => {
  const mutate = (offset: number, value: number) => { const bytes = Buffer.from(cafAlac); bytes.writeUInt32BE(value, offset); return bytes; };
  assert.throws(() => cafAst().parse(mutate(76, 0x66726565)), /configuration/);
  assert.throws(() => cafAst().parse(mutate(10172, 0x66726565)), /packet table/);
  assert.throws(() => cafAst().parse(mutate(44, 1)), /configuration/);
  const badSize = Buffer.from(cafAlac); badSize[10208] = 127;
  assert.throws(() => cafAst().parse(badSize), /ALAC|packet/);
  assert.throws(() => cafAst().parse(cafAlac, { limits: { maxSamplesPerTrack: 2 } }), /limit/i);
  assert.throws(() => cafAst().parse(cafAlac, { limits: { maxMemoryBytes: 128 } }), /limit/i);
  assert.equal(cafAst().probe(cafAlac).streams[0]!.codec_name, "alac");
  const copied = cafAst().serialize(cafAst().parse(cafAlac, { decodeAudio: false }), { audioCodec: "copy" });
  assert.equal(cafAst().parse(copied).tracks[0]!.decodedAudio!.channelData[0]!.length, 8200);
});

it("decodes native 16-bit ALAC with 1 channel(s)", () => {
  const bytes = Buffer.from("Y2FmZgABAABkZXNjAAAAAAAAACBAv0AAAAAAAGFsYWMAAAAAAAAAAAAAEAAAAAABAAAAAGNoYW4AAAAAAAAADABkAAEAAAAAAAAAAGt1a2kAAAAAAAAAMAAAAAxmcm1hYWxhYwAAACRhbGFjAAAAAAAAEAAAECgKDgEAAAAAIAQAAfQAAAAfQGluZm8AAAAAAAAAGQAAAAFlbmNvZGVyAExhdmY2My4xLjEwMQBkYXRhAAAAAAAAAC4AAAAAAAASAAAAIwABApcFLQfDClkM7w+FEhsUsRdHGd0ccx8JIZ8kNSbLKWHAcGFrdAAAAAAAAAAZAAAAAAAAAAEAAAAAAAAAEQAAAAAAAA/vKg==", "base64");
  const pcm = rawAudioAsts().find(p => p.id === "s16le")!.serialize(cafAst().parse(bytes));
  const expected = Buffer.alloc(34);
  for (let i = 0; i < 17; i++) expected.writeIntLE(i * 331 - 2 ** 15, i * 2, 2);
  assert.deepEqual(Buffer.from(pcm), expected);
});

it("decodes native 24-bit ALAC with 1 channel(s)", () => {
  const bytes = Buffer.from("Y2FmZgABAABkZXNjAAAAAAAAACBAv0AAAAAAAGFsYWMAAAAAAAAAAAAAEAAAAAABAAAAAGNoYW4AAAAAAAAADABkAAEAAAAAAAAAAGt1a2kAAAAAAAAAMAAAAAxmcm1hYWxhYwAAACRhbGFjAAAAAAAAEAAAGCgKDgEAAAAAMAQAAu4AAAAfQGluZm8AAAAAAAAAGQAAAAFlbmNvZGVyAExhdmY2My4xLjEwMQBkYXRhAAAAAAAAAD8AAAAAAAASAAAAIwAAAQAClwAFLQAHwwAKWQAM7wAPhQASGwAUsQAXRwAZ3QAccwAfCQAhnwAkNQAmywApYcBwYWt0AAAAAAAAABkAAAAAAAAAAQAAAAAAAAARAAAAAAAAD+87", "base64");
  const pcm = rawAudioAsts().find(p => p.id === "s24le")!.serialize(cafAst().parse(bytes));
  const expected = Buffer.alloc(51);
  for (let i = 0; i < 17; i++) expected.writeIntLE(i * 331 - 2 ** 23, i * 3, 3);
  assert.deepEqual(Buffer.from(pcm), expected);
});

it("decodes native 24-bit ALAC with 2 channel(s)", () => {
  const bytes = Buffer.from("Y2FmZgABAABkZXNjAAAAAAAAACBAv0AAAAAAAGFsYWMAAAAAAAAAAAAAEAAAAAACAAAAAGNoYW4AAAAAAAAADABlAAIAAAAAAAAAAGt1a2kAAAAAAAAAMAAAAAxmcm1hYWxhYwAAACRhbGFjAAAAAAAAEAAAGCgKDgIAAAAAYAQABdwAAAAfQGluZm8AAAAAAAAAGQAAAAFlbmNvZGVyAExhdmY2My4xLjEwMQBkYXRhAAAAAAAAAGsAAAAAIAAUAAAAIgICEwwBKAHKAVQASf9l/yoTDAHwAKIAdADGACf/OACXLcJY74QasUfccwmeNMth9o0juE7lehCnPdJo/5QqwVf/f/+AFADgBwBQBwBQCwCwCwCwCwCwEgJAWAmMQKKLgHBha3QAAAAAAAAAGQAAAAAAAAABAAAAAAAAABEAAAAAAAAP72c=", "base64");
  const pcm = rawAudioAsts().find(p => p.id === "s24le")!.serialize(cafAst().parse(bytes));
  const expected = Buffer.alloc(102);
  for (let i = 0; i < 34; i++) expected.writeIntLE(i * 331 - 2 ** 23, i * 3, 3);
  assert.deepEqual(Buffer.from(pcm), expected);
});
