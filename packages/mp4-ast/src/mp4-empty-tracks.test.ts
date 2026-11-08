import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "./index.js";

for (const fragmented of [false, true]) {
  for (const keepAudio of [false, true]) {
    it(`omits empty tracks only in regular MP4 (fragmented=${fragmented}, audio=${keepAudio})`, () => {
      const doc = parseMp4(createSyntheticMp4({ width: 4, height: 4, frameCount: 2, includeAudio: keepAudio }));
      const tracks = doc.tracks.map(track => track.type === "video"
        ? { ...track, samples: [], duration: 0 } : track);
      const output = parseMp4(serializeMp4({ ...doc, tracks }, { fragmented }));
      assert.deepEqual(output.tracks.map(track => track.type), [
        ...(fragmented ? ["video"] : []), ...(keepAudio ? ["audio"] : [])
      ]);
      if (keepAudio) {
        assert.deepEqual(output.tracks.find(track => track.type === "audio")!.samples.map(sample => sample.data),
          doc.tracks.find(track => track.type === "audio")!.samples.map(sample => sample.data));
      }
    });
  }
}
