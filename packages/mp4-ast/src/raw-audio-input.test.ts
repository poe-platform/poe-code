import assert from "node:assert/strict";
import { it } from "node:test";
import { rawAudioAsts } from "./containers/raw-audio.js";

const pcm = rawAudioAsts().find(plugin => plugin.id === "s16be")!;

it("requires explicit format selection and defaults raw audio to 44100 Hz mono", () => {
  const bytes = Uint8Array.of(0x40, 0x01, 0xbf, 0xff);
  assert.equal(pcm.detect(bytes), false);
  const doc = pcm.parse(bytes);
  assert.equal(doc.timescale, 44100);
  assert.equal(doc.tracks[0]!.decodedAudio!.channels, 1);
  assert.deepEqual(Array.from(doc.tracks[0]!.decodedAudio!.channelData[0]!), [16385 / 32768, -16385 / 32768]);
  const probe = pcm.probe(bytes, { sampleRate: 8000, channels: 2, decodeAudio: false });
  assert.equal(probe.streams[0]!.codec_name, "pcm_s16be");
  assert.equal(probe.streams[0]!.sample_rate, "8000");
  assert.equal(probe.streams[0]!.channels, 2);
});

it("rejects invalid parameters, truncated frames, and non-finite samples", () => {
  for (const invalid of [-1, 0, 1.5, Infinity, NaN]) {
    assert.throws(() => pcm.parse(new Uint8Array(4), { sampleRate: invalid }), /sample rate/);
    assert.throws(() => pcm.parse(new Uint8Array(4), { channels: invalid }), /channel count/);
  }
  assert.throws(() => pcm.parse(new Uint8Array(3)), /Incomplete/);
  assert.throws(() => pcm.parse(new Uint8Array(2), { channels: 2 }), /Incomplete/);
  const float = rawAudioAsts().find(plugin => plugin.id === "f32be")!;
  assert.throws(() => float.parse(Uint8Array.of(0x7f, 0x80, 0, 0)), /Non-finite/);
});

it("checks resource limits before allocating decoded samples", () => {
  const bytes = new Uint8Array(16);
  assert.throws(() => pcm.parse(bytes, { limits: { maxInputBytes: 15 } }), /maxInputBytes/);
  assert.throws(() => pcm.parse(bytes, { limits: { maxMemoryBytes: 63 } }), /maxMemoryBytes/);
  assert.throws(() => pcm.parse(bytes, { sampleRate: 8, limits: { maxDurationSeconds: 0.5 } }), /maxDurationSeconds/);
  assert.equal(pcm.parse(bytes, { decodeAudio: false, limits: { maxMemoryBytes: 0 } }).tracks[0]!.decodedAudio, undefined);
});

it("splits raw PCM into aligned PCM packets and accounts for their limit", () => {
  const bytes = new Uint8Array(4000);
  const doc = pcm.parse(bytes, { sampleRate: 8000, channels: 2, decodeAudio: false });
  assert.deepEqual(doc.tracks[0]!.samples.map(s => [s.pts, s.duration, s.size]),
    [[0, 512, 2048], [512, 488, 1952]]);
  assert.throws(() => pcm.parse(bytes, { sampleRate: 8000, limits: { maxSamplesPerTrack: 3 } }), /maxSamplesPerTrack/);
});

for (const [sampleRate, packetFrames] of [[8000, 512], [44100, 4096], [48000, 4096]] as const) {
  it(`packetizes raw PCM at ${sampleRate} Hz without splitting channel frames`, () => {
    const bytes = new Uint8Array((packetFrames * 2 + 3) * 6);
    const doc = pcm.parse(bytes, { sampleRate: sampleRate, channels: 3, decodeAudio: false });
    const packets = doc.tracks[0]!.samples;
    assert.deepEqual(packets.map(p => [p.pts, p.dts, p.duration, p.size]), [
      [0, 0, packetFrames, packetFrames * 6],
      [packetFrames, packetFrames, packetFrames, packetFrames * 6],
      [packetFrames * 2, packetFrames * 2, 3, 18]
    ]);
    assert.deepEqual(pcm.serialize(doc, { audioCodec: "copy" }), bytes);
    assert.throws(() => pcm.parse(bytes, {
      sampleRate: sampleRate, channels: 3, decodeAudio: false, limits: { maxSamplesPerTrack: 2 }
    }), /maxSamplesPerTrack/);
  });
}
