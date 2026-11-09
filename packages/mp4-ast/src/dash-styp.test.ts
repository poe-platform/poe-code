import assert from "node:assert/strict";
import { it } from "node:test";
import { concatBytes, createSyntheticMp4, MediaLimitExceededError, parseMp4, parseMp4Boxes, serializeDashDocument } from "./index.js";

const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 12, includeAudio: true }));
const source = { ...base, tracks: base.tracks.map(track => ({
  ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: track.type === "audio" || index % 4 === 0 }))
})) };

for (const fragmentType of ["none", "every_frame"] as const) {
  it(`brands each DASH segment once with ${fragmentType} fragmentation and preserves packet offsets`, () => {
    const { resources } = serializeDashDocument(source, { segmentDuration: 1, fragmentType });
    for (const [index, track] of source.tracks.entries()) {
      const initialization = resources.get(`init-stream${index}.m4s`)!;
      assert.deepEqual(parseMp4Boxes(initialization).map(box => box.type), ["ftyp", "moov"]);
      const segments = [...resources].filter(([uri]) => uri.startsWith(`chunk-stream${index}-`)).map(([, bytes]) => bytes);
      assert.equal(segments.length, 3);
      let sequence = 0;
      for (const bytes of segments) {
        const boxes = parseMp4Boxes(bytes);
        assert.deepEqual(boxes.slice(0, 2).map(box => [box.type, box.offset]), [["styp", 0], ["sidx", 24]]);
        assert.equal(boxes.filter(box => box.type === "styp").length, 1);
        // Native FFmpeg: size 24, major brand msdh, minor version 0, brands msdh/msix.
        assert.equal(Buffer.from(bytes.subarray(0, 24)).toString("hex"), "00000018737479706d736468000000006d7364686d736978");
        for (const moof of boxes.filter(box => box.type === "moof")) {
          assert.equal(new DataView(bytes.buffer, bytes.byteOffset + moof.offset).getUint32(20), ++sequence);
        }
      }
      const output = parseMp4(concatBytes([initialization, ...segments])).tracks[0]!;
      assert.deepEqual(output.samples.map(sample => [sample.dts, sample.pts, sample.duration, sample.data]),
        track.samples.map(sample => [sample.dts, sample.pts, sample.duration, sample.data]));
    }
  });
}

it("keeps single-file DASH segments indexed without standalone segment branding", () => {
  const { resources } = serializeDashDocument(source, { singleFile: true, segmentDuration: 1 });
  for (const [index, track] of source.tracks.entries()) {
    const bytes = resources.get(`stream${index}.mp4`)!;
    const boxes = parseMp4Boxes(bytes);
    assert.equal(boxes.filter(box => box.type === "styp").length, 0);
    assert.equal(boxes.filter(box => box.type === "sidx").length, 3);
    assert.deepEqual(parseMp4(bytes).tracks[0]!.samples.map(sample => sample.data), track.samples.map(sample => sample.data));
  }
});

it("counts DASH segment branding in the output byte limit", () => {
  const options = { segmentDuration: 1 };
  const { manifest, resources } = serializeDashDocument(source, options);
  const total = manifest.length + [...resources.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  assert.throws(() => serializeDashDocument(source, { ...options, limits: { maxOutputBytes: total - 1 } }), MediaLimitExceededError);
  assert.deepEqual(serializeDashDocument(source, { ...options, limits: { maxOutputBytes: total } }).resources, resources);
});
