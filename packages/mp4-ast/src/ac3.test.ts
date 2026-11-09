import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { allMediaAsts, createMediaAstRegistry, type MediaTrack, type MediaCodecDescription } from "./index.js";

const input = readFileSync(new URL("./fixtures/packet-copy.ac3", import.meta.url));
const registry = createMediaAstRegistry(allMediaAsts());

it("detects AC-3 by content and preserves complete compressed packets without decoding", () => {
  const plugin = registry.detect(input, "audio.bin");
  assert.equal(plugin?.id, "ac3");
  const doc = plugin!.parse(input);
  const track = doc.tracks[0]!;
  assert.equal(doc.timescale, 90000);
  assert.equal(track.timescale, 90000);
  assert.equal(track.duration, 37440);
  assert.equal(track.decodedAudio, undefined);
  assert.equal(track.codecDescriptions[0]!.sampleRate, 48000);
  assert.equal(track.codecDescriptions[0]!.channels, 1);
  assert.equal(track.samples.length, 13);
  for (const [index, sample] of track.samples.entries()) {
    assert.deepEqual([sample.pts, sample.dts, sample.duration, sample.offset, sample.size],
      [index * 2880, index * 2880, 2880, index * 384, 384]);
    assert.deepEqual(sample.data, input.subarray(index * 384, (index + 1) * 384));
    assert.equal(sample.data.buffer, input.buffer);
  }
});

it("reads 44.1 kHz alternating frame sizes and reduced sample rates", () => {
  const plugin = registry.findByFormatName("ac3");
  assert.ok(plugin);
  for (const [code, bsid, sizes, rate, duration] of [
    [0x4c, 8, [416, 418], 44100, 3134], [0x8c, 8, [576, 576], 32000, 4320],
    [0x0c, 9, [384, 384], 24000, 5760], [0x0c, 10, [384, 384], 12000, 11520]
  ] as const) {
    const frames = sizes.map((size, index) => {
      const frame = Buffer.alloc(size);
      frame.set(input.subarray(0, 7));
      frame[4] = code + index;
      frame[5] = bsid << 3;
      return frame;
    });
    const track: MediaTrack = plugin.parse(Buffer.concat(frames)).tracks[0]!;
    assert.equal(track.codecDescriptions[0]!.sampleRate, rate);
    assert.deepEqual(track.samples.map(sample => [sample.size, sample.pts, sample.duration]),
      sizes.map((size, index) => [size, index * duration, duration]));
  }
});

it("reads channel modes and their conditional LFE flag", () => {
  const plugin = registry.findByFormatName("ac3");
  assert.ok(plugin);
  for (const [header, channels, layout] of [[0x40, 2, "stereo"], [0x44, 3, "2.1"],
    [0xe0, 5, "5.0(side)"], [0xe1, 6, "5.1(side)"], [0x30, 2, "2 channels (FC+LFE)"]] as const) {
    const bytes = Buffer.from(input.subarray(0, 384));
    bytes[6] = header;
    const codec: MediaCodecDescription = plugin.parse(bytes).tracks[0]!.codecDescriptions[0]!;
    assert.equal(codec.channels, channels);
    assert.equal(codec.channelLayout, layout);
  }
});

it("rejects invalid, E-AC-3, and truncated frames", () => {
  const plugin = registry.findByFormatName("ac3");
  assert.ok(plugin);
  for (const bytes of [Buffer.alloc(0), input.subarray(0, 6), input.subarray(0, -1)]) {
    assert.throws(() => plugin.parse(bytes), /AC-3/);
  }
  for (const [offset, value] of [[0, 0], [4, 0xc0], [4, 38], [5, 11 << 3]]) {
    const bytes = Buffer.from(input);
    bytes[offset!] = value!;
    assert.throws(() => plugin.parse(bytes), /AC-3/);
    assert.equal(plugin.detect(bytes), false);
  }
});

it("honors input, packet count, duration, stream, memory, and CPU limits", () => {
  const plugin = registry.findByFormatName("ac3");
  assert.ok(plugin);
  for (const limits of [{ maxInputBytes: 4991 }, { maxSamplesPerTrack: 12 },
    { maxDurationSeconds: 0.4 }, { maxStreams: 0 }, { maxMemoryBytes: 128 }, { maxCpuMs: -1 }]) {
    assert.throws(() => plugin.parse(input, { limits }), /limit/i);
  }
});
