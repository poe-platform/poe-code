import assert from "node:assert/strict";
import { it } from "node:test";
import { parseAudio } from "@poe-code/audio-ast";
import { oggAst } from "./containers/adapters.js";
import { createSyntheticMp4, parseMp4 } from "./mp4.js";

for (const codec of ["vorbis", "opus"] as const) {
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
