import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4, parseMp4Boxes } from "./index.js";

for (const includeAudio of [false, true]) {
  it(`cuts fragments at every frame and preserves packets (audio=${includeAudio})`, () => {
    const doc = parseMp4(createSyntheticMp4({ frameCount: 12, fps: 4, includeAudio }));
    const tracks = doc.tracks.map(track => track.type === "video" ? {
      ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
    } : track);
    const bytes = serializeMp4({ ...doc, tracks }, { fragmented: true, fragmentEveryFrame: true });
    const boxes = parseMp4Boxes(bytes);
    const moofs = boxes.filter(box => box.type === "moof");
    assert.equal(moofs.length, 1 + new Set(tracks.flatMap(track => track.samples.slice(1).map(sample => sample.dts / track.timescale))).size);
    const init = bytes.subarray(0, moofs[0]!.offset);
    for (const [index, moof] of moofs.entries()) {
      const end = moofs[index + 1]?.offset ?? bytes.length;
      const fragment = parseMp4(new Uint8Array(Buffer.concat([init, bytes.subarray(moof.offset, end)])));
      for (const track of fragment.tracks) {
        assert.ok(track.samples.length <= 1);
        if (track.samples.length === 0) continue;
        const original = tracks.find(candidate => candidate.id === track.id)!;
        const sample = track.samples[0]!;
        const expected = original.samples.find(candidate => candidate.dts === sample.dts)!;
        assert.deepEqual(sample.data, expected.data);
        assert.equal(sample.isKeyframe, expected.isKeyframe);
      }
      const mfhd = moof.children!.find(box => box.type === "mfhd")!;
      assert.equal(new DataView(mfhd.payload.buffer, mfhd.payload.byteOffset).getUint32(4), index + 1);
    }
    const output = parseMp4(bytes);
    for (const [index, track] of tracks.entries()) {
      const packets = (samples: typeof track.samples) => samples.map(({ data, dts, pts, duration, isKeyframe }) => ({ data, dts, pts, duration, isKeyframe }));
      assert.deepEqual(packets(output.tracks[index]!.samples), packets(track.samples));
    }
    assert.equal(parseMp4Boxes(serializeMp4({ ...doc, tracks }, { fragmented: true })).filter(box => box.type === "moof").length, 1);
  });
}
