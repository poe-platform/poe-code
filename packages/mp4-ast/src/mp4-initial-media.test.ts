import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4, parseMp4Boxes } from "./index.js";

for (const includeAudio of [false, true]) {
  for (const keyframes of [true, false]) {
    it(`preserves initial media before fragments (audio=${includeAudio}, keyframes=${keyframes})`, () => {
      const doc = parseMp4(createSyntheticMp4({ frameCount: 12, fps: 4, includeAudio }));
      const tracks = doc.tracks.map(track => track.type === "video" ? {
        ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: keyframes ? index % 4 === 0 : index === 0 }))
      } : track);
      const bytes = serializeMp4({ ...doc, tracks }, { fragmented: true, fragmentKeyframes: true, emptyMoov: false });
      const boxes = parseMp4Boxes(bytes);
      assert.deepEqual(boxes.map(box => box.type), keyframes
        ? ["ftyp", "moov", "mdat", "moof", "mdat", "moof", "mdat", "mfra"]
        : ["ftyp", "moov", "mdat", "mfra"]);
      const initial = parseMp4(bytes.subarray(0, boxes.find(box => box.type === "moof")?.offset ?? bytes.length));
      assert.equal(initial.tracks.find(track => track.type === "video")!.samples.length, keyframes ? 4 : 12);
      const output = parseMp4(bytes);
      for (const [index, track] of tracks.entries()) {
        const packets = (samples: typeof track.samples) => samples.map(({ data, dts, pts, duration, isKeyframe }) => ({ data, dts, pts, duration, isKeyframe }));
        assert.deepEqual(packets(output.tracks[index]!.samples), packets(track.samples));
      }
    });
  }
}
