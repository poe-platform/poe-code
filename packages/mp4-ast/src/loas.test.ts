import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { BitWriter, allMediaAsts, createMediaAstRegistry, parseMp4, parseWav, serializeWav, decodeAacTrack } from "./index.js";

// Native FFmpeg 7.0.2: AAC-LC, 48 kHz mono; M4A remuxed with -c:a copy -f latm.
const bytes = readFileSync(new URL("./fixtures/loas.latm", import.meta.url));
const registry = createMediaAstRegistry(allMediaAsts());

it("detects raw LOAS by signature and exposes the loas/latm format names", () => {
  assert.equal(registry.detect(bytes, "input.bin")?.id, "latm");
  assert.equal(registry.findByFormatName("latm")?.id, "latm");
  assert.equal(registry.findByFormatName("loas")?.id, "latm");
});

it("preserves all 31 physical LOAS packets for probing and stream copy", () => {
  const plugin = registry.findById("latm")!;
  const doc = plugin.parse(bytes, { decodeAudio: false });
  assert.equal(doc.tracks[0]!.samples.length, 31);
  assert.equal(doc.tracks[0]!.decodedAudio, undefined);
  assert.deepEqual(Buffer.from(plugin.serialize(doc)), bytes);
  const probe = plugin.probe(bytes, { showPackets: true });
  assert.equal(probe.format.format_name, "loas");
  assert.equal(probe.streams[0]!.codec_name, "aac_latm");
  assert.equal(probe.streams[0]!.sample_rate, "48000");
  assert.equal(probe.streams[0]!.channels, 1);
  assert.equal(probe.packets!.length, 31);
  let offset = 0;
  for (const packet of probe.packets!) {
    assert.equal(packet.pos, String(offset));
    offset += Number(packet.size);
  }
  assert.equal(offset, bytes.length);
});

it("decodes LOAS to the native 31744 mono PCM16 samples without trimming priming", () => {
  const doc = registry.findById("latm")!.parse(bytes);
  const wav = parseWav(serializeWav(doc));
  const pcm = Buffer.concat(wav.tracks[0]!.samples.map(sample => sample.data));
  assert.equal(pcm.length, 31744 * 2);
  const native = parseWav(readFileSync(new URL("./fixtures/loas-native.wav", import.meta.url)));
  const expected = Buffer.concat(native.tracks[0]!.samples.map(sample => sample.data));
  assert.equal(createHash("sha256").update(expected).digest("hex"),
    "62ee7ad57aa43b47b7497b7707b09944e8a4789e920ddd4b4d612bd826ef1e59");
  // Native and portable AAC decoders can differ by one PCM16 unit at rounding boundaries.
  for (let i = 0; i < pcm.length; i += 2) {
    assert.ok(Math.abs(pcm.readInt16LE(i) - expected.readInt16LE(i)) <= 1, `sample ${i / 2}`);
  }
  const control = parseMp4(readFileSync(new URL("./fixtures/loas-control.m4a", import.meta.url)));
  const controlTrack = control.tracks[0]!;
  const complete = decodeAacTrack(control, { ...controlTrack, editList: [], duration: 31744 });
  assert.deepEqual(doc.tracks[0]!.decodedAudio!.channelData, complete.channelData);
  assert.equal(parseWav(serializeWav(control)).tracks[0]!.decodedAudio!.channelData[0]!.length, 30720);
});

it("preserves an explicitly encoded AAC sample rate", () => {
  const length = ((bytes[1]! & 31) << 8) + bytes[2]!;
  const config = new BitWriter();
  config.writeBits(2, 5); config.writeBits(15, 4); config.writeBits(48000, 24);
  config.writeBits(1, 4); config.writeBits(0, 3);
  const explicit = Buffer.concat([Buffer.from([0x56, 0xe0 | ((length + 3) >>> 8), (length + 3) & 255]),
    bytes.subarray(3, 5), config.toUint8Array(), bytes.subarray(7)]);
  const plugin = registry.findById("latm")!;
  assert.deepEqual(plugin.parse(explicit).tracks[0]!.decodedAudio, plugin.parse(bytes).tracks[0]!.decodedAudio);
});

it("retains existing AAC-to-LATM output and enforces copied output budgets", () => {
  const plugin = registry.findById("latm")!;
  const control = parseMp4(readFileSync(new URL("./fixtures/loas-control.m4a", import.meta.url)));
  assert.deepEqual(Buffer.from(plugin.serialize(control)), bytes);
  const doc = plugin.parse(bytes, { decodeAudio: false });
  assert.throws(() => plugin.serialize(doc, { limits: { maxOutputBytes: 10 } }), /Resource limit/);
});

it("rejects truncated LOAS packets, missing initial config and unsupported mux versions", () => {
  const plugin = registry.findById("latm")!;
  const firstSize = 3 + ((bytes[1]! & 31) << 8) + bytes[2]!;
  const version = Buffer.from(bytes); version[3]! |= 0x40;
  for (const input of [bytes.subarray(0, 2), bytes.subarray(0, 4), bytes.subarray(0, -1),
    bytes.subarray(firstSize), version]) {
    assert.throws(() => plugin.parse(input), /LOAS|LATM/);
  }
});

it("enforces input, sample, duration and memory budgets", () => {
  const plugin = registry.findById("latm")!;
  for (const limits of [{ maxInputBytes: 10 }, { maxSamplesPerTrack: 2 },
    { maxDurationSeconds: 0.01 }, { maxMemoryBytes: 32 }, { maxFrames: 1 }, { maxStreams: 0 }]) {
    assert.throws(() => plugin.parse(bytes, { limits }), /Resource limit/);
  }
});
