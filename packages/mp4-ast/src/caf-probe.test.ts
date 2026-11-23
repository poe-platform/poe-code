import assert from "node:assert/strict";
import { it } from "node:test";
import { cafAst } from "./containers/caf.js";
import { rawAudioAsts } from "./containers/raw-audio.js";
import { cafAlac } from "./caf-alac-fixture.js";
import { cafIma } from "./caf-ima-fixture.js";

// Native FFprobe 7.0.2: the CAF description supplies tags, and compressed
// stream frame counts describe audio frames rather than demuxed packets.
for (const [codec, tag, hex] of [
  ["s16le", "lpcm", "0x6d63706c"],
  ["mulaw", "ulaw", "0x77616c75"],
  ["alaw", "alaw", "0x77616c61"]
]) it(`reports the CAF ${codec} format tag`, () => {
  const raw = rawAudioAsts().find(plugin => plugin.id === codec)!;
  const bytes = cafAst().serialize(raw.parse(new Uint8Array(16), { sampleRate: 8000, channels: 1 }), { audioCodec: "copy" });
  const stream = cafAst().probe(bytes).streams[0]!;
  assert.equal(stream.codec_tag_string, tag);
  assert.equal(stream.codec_tag, hex);
});

for (const [name, bytes, duration, samples, packets, bits, bitRate] of [
  ["ALAC", cafAlac, 12288, 8200, 3, 0, undefined],
  ["IMA", cafIma, 8256, 8256, 129, 4, "68000"]
] as const) it(`reports native CAF ${name} stream dimensions independently of decoded samples`, () => {
  const ast = cafAst();
  const probe = ast.probe(bytes, { showFrames: true });
  const stream = probe.streams[0]!;
  assert.equal(stream.sample_fmt, "s16p");
  assert.equal(stream.bits_per_sample, bits);
  assert.equal(stream.bit_rate, bitRate);
  assert.equal(stream.duration_ts, duration);
  assert.equal(stream.duration, (duration / 8000).toFixed(6));
  assert.equal(stream.nb_frames, String(duration));
  assert.equal(stream.nb_read_packets, String(packets));
  assert.equal(stream.nb_read_frames, String(packets));
  assert.equal(probe.format.duration, (duration / 8000).toFixed(6));
  assert.ok(probe.frames!.every(frame => frame.sample_fmt === "s16p"));
  assert.equal(probe.frames!.reduce((count, frame) => count + frame.nb_samples!, 0), samples);
  const doc = ast.parse(bytes);
  assert.equal(doc.duration, samples);
  assert.equal(doc.tracks[0]!.decodedAudio!.channelData[0]!.length, samples);
});

it("enforces duration limits against the declared ALAC packet framing", () => {
  assert.throws(() => cafAst().probe(cafAlac, { limits: { maxDurationSeconds: 1.2 } }), /limit/i);
});

it("reports 24-bit CAF ALAC as planar 32-bit samples", () => {
  const bytes = Buffer.from("Y2FmZgABAABkZXNjAAAAAAAAACBAv0AAAAAAAGFsYWMAAAAAAAAAAAAAEAAAAAABAAAAAGNoYW4AAAAAAAAADABkAAEAAAAAAAAAAGt1a2kAAAAAAAAAMAAAAAxmcm1hYWxhYwAAACRhbGFjAAAAAAAAEAAAGCgKDgEAAAAAMAQAAu4AAAAfQGluZm8AAAAAAAAAGQAAAAFlbmNvZGVyAExhdmY2My4xLjEwMQBkYXRhAAAAAAAAAD8AAAAAAAASAAAAIwAAAQAClwAFLQAHwwAKWQAM7wAPhQASGwAUsQAXRwAZ3QAccwAfCQAhnwAkNQAmywApYcBwYWt0AAAAAAAAABkAAAAAAAAAAQAAAAAAAAARAAAAAAAAD+87", "base64");
  const probe = cafAst().probe(bytes, { showFrames: true });
  assert.equal(probe.streams[0]!.sample_fmt, "s32p");
  assert.equal(probe.streams[0]!.duration_ts, 4096);
  assert.equal(probe.streams[0]!.nb_frames, "4096");
  assert.equal(probe.frames![0]!.sample_fmt, "s32p");
  assert.equal(probe.frames![0]!.nb_samples, 17);
});
