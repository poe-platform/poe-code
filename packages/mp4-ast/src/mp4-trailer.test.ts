import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4, parseMp4Boxes } from "./index.js";

for (const emptyMoov of [true, false]) {
  it(`indexes real random access points (emptyMoov=${emptyMoov})`, () => {
    const doc = parseMp4(createSyntheticMp4({ frameCount: 12, fps: 4, includeAudio: true }));
    const tracks = doc.tracks.map(track => track.type === "video" ? { ...track,
      samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
    } : track);
    const bytes = serializeMp4({ ...doc, tracks }, { fragmented: true, fragmentKeyframes: true, emptyMoov });
    const boxes = parseMp4Boxes(bytes);
    const trailer = boxes.at(-1)!;
    assert.equal(trailer.type, "mfra");
    const children = parseMp4Boxes(trailer.payload);
    assert.equal(children.at(-1)!.type, "mfro");
    const footer = children.at(-1)!.payload;
    assert.equal(new DataView(footer.buffer, footer.byteOffset).getUint32(4), trailer.size);
    for (const tfra of children.filter(box => box.type === "tfra")) {
      const view = new DataView(tfra.payload.buffer, tfra.payload.byteOffset);
      assert.equal(view.getUint8(0), 1);
      const track = tracks.find(track => track.id === view.getUint32(4))!;
      const moofs = boxes.filter(box => box.type === "moof");
      assert.equal(view.getUint32(12), moofs.length);
      for (let i = 0; i < moofs.length; i++) {
        const offset = 16 + i * 19;
        assert.equal(Number(view.getBigUint64(offset + 8)), moofs[i]!.offset);
        const traf = moofs[i]!.children!.filter(box => box.type === "traf")[view.getUint8(offset + 16) - 1]!;
        const tfhd = traf.children!.find(box => box.type === "tfhd")!.payload;
        assert.equal(new DataView(tfhd.buffer, tfhd.byteOffset).getUint32(4), track.id);
        assert.equal(view.getUint8(offset + 17), 1);
        assert.equal(view.getUint8(offset + 18), 1);
        assert.ok(track.samples.some(sample => sample.isKeyframe && sample.pts === Number(view.getBigUint64(offset))));
      }
    }
    assert.equal(children.filter(box => box.type === "tfra").length, tracks.length);
    assert.deepEqual(parseMp4(bytes).tracks.map(track => track.samples.map(sample => sample.data)), tracks.map(track => track.samples.map(sample => sample.data)));
  });
}
