import assert from "node:assert/strict";
import { it } from "node:test";
import { rawAudioAsts } from "./containers/raw-audio.js";
import { cafAst } from "./containers/caf.js";
import { allMediaAsts } from "./containers/adapters.js";

it("probes VIDC as eight-bit companded audio decoded to signed PCM16", () => {
  const vidc = allMediaAsts().find(plugin => plugin.id === "vidc");
  assert.ok(vidc);
  const bytes = Uint8Array.of(0, 1, 254, 255);
  assert.equal(vidc.detect(bytes), false);
  const probe = vidc.probe(bytes, { sampleRate: 8000, channels: 2 });
  assert.equal(probe.streams[0]!.codec_name, "pcm_vidc");
  assert.equal(probe.streams[0]!.sample_fmt, "s16");
  assert.equal(probe.streams[0]!.sample_rate, "8000");
  assert.equal(probe.streams[0]!.channels, 2);
  const doc = vidc.parse(bytes, { sampleRate: 8000, channels: 2 });
  assert.equal(doc.duration, 2);
  assert.deepEqual(doc.tracks[0]!.decodedAudio!.channelData.map(channel => Array.from(channel)),
    [[0, 32124 / 32768], [0, -32124 / 32768]]);
  assert.throws(() => vidc.parse(bytes, { limits: { maxMemoryBytes: 31 } }), /maxMemoryBytes/);
  assert.equal(vidc.parse(bytes, { decodeAudio: false, limits: { maxMemoryBytes: 0 } }).tracks[0]!.decodedAudio, undefined);
});

it("does not advertise VIDC encoding or CAF support when adding the raw demuxer", () => {
  const vidc = allMediaAsts().find(plugin => plugin.id === "vidc");
  assert.ok(vidc);
  assert.equal(vidc.canDemux, true);
  assert.equal(cafAst().supportedAudioCodecs.includes("pcm_vidc"), false);
  const pcm = rawAudioAsts().find(plugin => plugin.id === "s16le")!;
  const doc = pcm.parse(Uint8Array.of(0, 0));
  assert.throws(() => pcm.serialize(doc, { audioCodec: "pcm_vidc" }), /Unsupported raw audio encoder/);
});
