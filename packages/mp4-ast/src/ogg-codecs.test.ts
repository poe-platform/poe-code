import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav, parseAudio, readOgg } from "@poe-code/audio-ast";
import { oggAst, parseWav } from "./containers/adapters.js";
import { createSyntheticMp4, parseMp4 } from "./mp4.js";

for (const codec of ["vorbis", "opus"] as const) {
  it(`writes ${codec} comments without changing encoded audio or timing`, () => {
    const doc = { ...parseWav(encodeWav({ sampleRate: 48000,
      channels: [Float64Array.from({ length: 4800 }, (_, i) => Math.sin(i * 0.1) * 0.4)] })),
      metadata: { title: "Original", artist: "Renée" } };
    const plugin = oggAst();
    const original = plugin.serialize(doc, { audioCodec: codec });
    assert.equal(parseAudio(original).streams[0]!.tags?.TITLE, "Original");
    assert.equal(parseAudio(original).streams[0]!.tags?.ARTIST, "Renée");
    const updated = plugin.serialize(doc, { audioCodec: codec, metadata: { title: "Review" } });
    assert.equal(parseAudio(updated).streams[0]!.tags?.TITLE, "Review");
    const packets = readOgg(original).packets;
    const rewritten = readOgg(updated).packets;
    assert.equal(rewritten.length, packets.length);
    for (const [index, packet] of packets.entries()) {
      if (index !== 1) assert.deepEqual(rewritten[index], packet);
    }
  });
  for (const channels of [1, 2]) {
    it(`encodes playable ${codec} headers and accurate duration for ${channels} channels`, () => {
      const base = parseMp4(createSyntheticMp4({ includeAudio: true, frameCount: 1 }));
      const audio = base.tracks.find(track => track.type === "audio")!;
      const samples = Float32Array.from({ length: 22050 }, (_, index) => Math.sin(2 * Math.PI * 440 * index / 44100) * 0.5);
      const bytes = oggAst().serialize({ ...base, tracks: [{
        ...audio,
        decodedAudio: { sampleRate: 44100, channels, channelData: Array.from({ length: channels }, () => samples) }
      }] }, { format: codec === "opus" ? "opus" : "ogg" });
      const parsed = parseAudio(bytes);
      assert.equal(parsed.streams[0]!.codec, codec);
      assert.equal(parsed.streams[0]!.channels, channels);
      assert.equal(parsed.duration, 0.5);
      const document = oggAst().parse(bytes);
      assert.equal(document.tracks[0]!.codecDescriptions[0]!.codecName, codec);
      assert.equal(document.durationSeconds, 0.5);
    });
  }
}
