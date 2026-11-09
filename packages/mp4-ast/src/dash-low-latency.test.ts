import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, parseMp4Boxes, serializeDashDocument } from "./index.js";

for (const [frameCount, keyframes, segmentDuration, expected] of [
  [16, [0, 4, 8, 12], 1, 1],
  [16, [0, 4, 8, 12], 2, 1],
  [16, [0, 8, 12], 1, 2],
  [3, [0], 1, 1.5]
] as const) {
  for (const singleFile of [false, true]) {
    it(`uses GOP timing for low-latency DASH buffering: ${JSON.stringify({ frameCount, keyframes, segmentDuration, singleFile })}`, () => {
      const source = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount, includeAudio: false }));
      const doc = { ...source, tracks: source.tracks.map(track => ({ ...track,
        samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: (keyframes as readonly number[]).includes(index) }))
      })) };
      const { resources, manifest } = serializeDashDocument(doc, { lowLatency: true, streaming: false, singleFile, segmentDuration });
      const xml = new TextDecoder().decode(manifest);
      assert.equal(Number(xml.split('minBufferTime="PT')[1]!.split('S"')[0]), expected);
      const boxes = [...resources.values()].flatMap(bytes => parseMp4Boxes(bytes));
      assert.equal(boxes.filter(box => box.type === "moof").length, frameCount);
      assert.equal(boxes.filter(box => box.type === "sidx").length, 0);
      assert.ok(!xml.includes("indexRange="));
    });
  }
}
