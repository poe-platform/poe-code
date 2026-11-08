import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, parseMp4Boxes, serializeMp4 } from "./index.js";

for (const defaultBaseMoof of [false, true]) {
  for (const emptyMoov of [false, true]) {
    it(`preserves audio/video packets with relative=${defaultBaseMoof}, emptyMoov=${emptyMoov}`, () => {
      const doc = parseMp4(createSyntheticMp4({ frameCount: 12, fps: 4, includeAudio: true }));
      const bytes = serializeMp4(doc, { fragmented: true, fragmentDuration: 500000, defaultBaseMoof, emptyMoov });
      const moofs = parseMp4Boxes(bytes).filter(box => box.type === "moof");
      assert.ok(moofs.length > 1);
      for (const moof of moofs) {
        for (const traf of moof.children!.filter(box => box.type === "traf")) {
          const tfhd = traf.children!.find(box => box.type === "tfhd")!;
          const view = new DataView(tfhd.payload.buffer, tfhd.payload.byteOffset);
          assert.equal(view.getUint32(0) & 0x020001, defaultBaseMoof ? 0x020000 : 1);
          if (!defaultBaseMoof) assert.equal(Number(view.getBigUint64(8)), moof.offset);
        }
      }
      const packets = (track: typeof doc.tracks[number]) => track.samples.map(({ data, dts, pts, duration, isKeyframe }) => ({ data, dts, pts, duration, isKeyframe }));
      assert.deepEqual(parseMp4(bytes).tracks.map(packets), doc.tracks.map(packets));
    });
  }
}
