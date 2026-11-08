import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4, parseMp4Boxes } from "./index.js";

for (const [fragmentDuration, fragmentKeyframes, expected] of [
  [500000, false, [2, 2, 2, 2, 2, 2]],
  [600000, false, [3, 3, 3, 3]],
  [600000, true, [3, 1, 3, 1, 3, 1]],
  [0, false, [12]],
  [4000000, false, [12]]
] as const) {
  it(`cuts at elapsed packet time (${fragmentDuration}us, keyframes=${fragmentKeyframes})`, () => {
    const doc = parseMp4(createSyntheticMp4({ frameCount: 12, fps: 4, includeAudio: false }));
    const tracks = doc.tracks.map(track => ({ ...track,
      samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
    }));
    const bytes = serializeMp4({ ...doc, tracks }, { fragmented: true, fragmentDuration, fragmentKeyframes });
    const counts = parseMp4Boxes(bytes).filter(box => box.type === "moof").map(moof => {
      const trun = moof.children!.find(box => box.type === "traf")!.children!.find(box => box.type === "trun")!;
      return new DataView(trun.payload.buffer, trun.payload.byteOffset).getUint32(4);
    });
    assert.deepEqual(counts, expected);
    const packets = (samples: typeof doc.tracks[number]["samples"]) => samples.map(({ data, dts, pts, duration, isKeyframe }) => ({ data, dts, pts, duration, isKeyframe }));
    assert.deepEqual(packets(parseMp4(bytes).tracks[0]!.samples), packets(tracks[0]!.samples));
  });
}

it("cuts at exact microsecond durations despite fractional-second rounding", () => {
  const doc = parseMp4(createSyntheticMp4({ frameCount: 10, fps: 10, includeAudio: false }));
  const bytes = serializeMp4(doc, { fragmented: true, fragmentDuration: 100000 });
  assert.equal(parseMp4Boxes(bytes).filter(box => box.type === "moof").length, 10);
});
