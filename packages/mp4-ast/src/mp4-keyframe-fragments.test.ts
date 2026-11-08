import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4, parseMp4Boxes } from "./index.js";

for (const includeAudio of [false, true]) {
  it(`cuts fragments at video keyframes and preserves packets (audio=${includeAudio})`, () => {
    const doc = parseMp4(createSyntheticMp4({ frameCount: 12, fps: 4, includeAudio }));
    const tracks = doc.tracks.map(track => track.type === "video" ? {
      ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
    } : track);
    const bytes = serializeMp4({ ...doc, tracks }, { fragmented: true, fragmentKeyframes: true });
    const boxes = parseMp4Boxes(bytes);
    const moofs = boxes.filter(box => box.type === "moof");
    assert.equal(moofs.length, 3);
    const init = bytes.subarray(0, moofs[0]!.offset);
    for (const [index, moof] of moofs.entries()) {
      const end = moofs[index + 1]?.offset ?? bytes.length;
      const fragment = parseMp4(new Uint8Array(Buffer.concat([init, bytes.subarray(moof.offset, end)])));
      const video = fragment.tracks.find(track => track.type === "video")!;
      assert.equal(video.samples.length, 4);
      assert.equal(video.samples[0]!.isKeyframe, true);
      assert.equal(video.samples[0]!.dts, tracks[0]!.samples[index * 4]!.dts);
      assert.deepEqual(video.samples.map(sample => sample.data), tracks[0]!.samples.slice(index * 4, index * 4 + 4).map(sample => sample.data));
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

it("keeps audio-only fragmented output in one fragment", () => {
  const doc = parseMp4(createSyntheticMp4({ frameCount: 4, includeAudio: true }));
  const bytes = serializeMp4({ ...doc, tracks: doc.tracks.filter(track => track.type === "audio") }, { fragmented: true, fragmentKeyframes: true });
  assert.equal(parseMp4Boxes(bytes).filter(box => box.type === "moof").length, 1);
});
