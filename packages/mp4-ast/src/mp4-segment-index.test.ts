import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, parseMp4Boxes, serializeMp4 } from "./index.js";

for (const segmentIndex of ["global", "fragment"] as const) {
  for (const defaultBaseMoof of [true, false]) {
    it(`addresses fragments and random-access entries with ${segmentIndex} indexes and defaultBaseMoof=${defaultBaseMoof}`, () => {
      const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 12, fps: 4, includeAudio: false }));
      const video = doc.tracks[0]!;
      const tracks = [1, 2].map(id => ({ ...video, id,
        samples: video.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
      }));
      const bytes = serializeMp4({ ...doc, tracks }, {
        fragmented: true, fragmentKeyframes: true, segmentIndex, defaultBaseMoof
      });
      const boxes = parseMp4Boxes(bytes);
      const moofs = boxes.filter(box => box.type === "moof");
      const indexes = boxes.filter(box => box.type === "sidx");
      assert.equal(indexes.length, segmentIndex === "global" ? 2 : 6);
      for (const [index, box] of indexes.entries()) {
        const view = new DataView(box.payload.buffer, box.payload.byteOffset);
        const count = view.getUint16(30);
        assert.equal(count, segmentIndex === "global" ? 3 : 1);
        assert.equal(view.getUint32(4), index % 2 + 1);
        let offset = box.offset + box.size + Number(view.getBigUint64(20));
        for (let ref = 0; ref < count; ref++) {
          const moof = moofs[segmentIndex === "global" ? ref : Math.floor(index / 2)]!;
          const mdat = boxes.find(candidate => candidate.offset === moof.offset + moof.size)!;
          assert.equal(offset, moof.offset);
          assert.equal(view.getUint32(32 + ref * 12), moof.size + mdat.size);
          assert.equal(view.getUint32(36 + ref * 12), video.timescale);
          offset += view.getUint32(32 + ref * 12);
        }
      }
      for (const tfra of boxes.find(box => box.type === "mfra")!.children!.filter(box => box.type === "tfra")) {
        const view = new DataView(tfra.payload.buffer, tfra.payload.byteOffset);
        assert.equal(view.getUint32(12), 3);
        for (let index = 0; index < 3; index++) {
          assert.equal(Number(view.getBigUint64(24 + index * 19)), moofs[index]!.offset);
        }
      }
      const output = parseMp4(bytes);
      assert.deepEqual(output.tracks.map(track => track.samples.map(sample => sample.data)),
        tracks.map(track => track.samples.map(sample => sample.data)));
    });
  }
}
