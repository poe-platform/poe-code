import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, parseMp4Boxes, serializeMp4 } from "./mp4.js";

for (const [trackNumber, discNumber] of [["3/12", "1/2"], ["2", "1"]]) {
  it(`writes numeric MP4 metadata ${trackNumber}, ${discNumber}`, () => {
    const source = parseMp4(createSyntheticMp4({ frameCount: 2, includeAudio: true }));
    const output = parseMp4(serializeMp4({ ...source, metadata: { trackNumber, discNumber } }));
    assert.equal(output.metadata.trackNumber, trackNumber);
    assert.equal(output.metadata.discNumber, discNumber);
    assert.deepEqual(output.tracks.map(t => t.samples.map(s => s.data)), source.tracks.map(t => t.samples.map(s => s.data)));
    assert.ok(output.boxes);
    const moov = output.boxes.find(b => b.type === "moov")!;
    const ilst = moov.children!.find(b => b.type === "udta")!.children!.find(b => b.type === "meta")!.children!.find(b => b.type === "ilst")!;
    for (const [type, value, length] of [["trkn", trackNumber!, 16], ["disk", discNumber!, 14]] as const) {
      const item = ilst.children!.find(b => b.type === type)!;
      const data = parseMp4Boxes(item.payload)[0]!.payload;
      const [number, total = "0"] = value.split("/");
      assert.equal(data.length, length);
      assert.deepEqual(Array.from(data.subarray(0, 10)), Array(10).fill(0));
      assert.equal(new DataView(data.buffer, data.byteOffset).getUint16(10), Number(number));
      assert.equal(new DataView(data.buffer, data.byteOffset).getUint16(12), Number(total));
    }
  });
}
