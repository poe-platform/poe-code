import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeDashDocument } from "./index.js";

for (const segmentDuration of [0.5, 1, 2, undefined]) {
  it(`declares the DASH segment target independently of keyframe spacing: ${segmentDuration ?? "default"}`, () => {
    const source = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 24, includeAudio: false }));
    const doc = { ...source, tracks: source.tracks.map(track => ({
      ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
    })) };
    const { manifest } = serializeDashDocument(doc, { segmentDuration });
    const xml = new TextDecoder().decode(manifest);
    const value = xml.split('maxSegmentDuration="PT')[1]?.split('S"')[0];
    assert.equal(Number(value), segmentDuration ?? 5);
    if (segmentDuration === 0.5) {
      const duration = xml.split('<S t="0" d="')[1]!.split('"')[0]!;
      assert.equal(Number(duration) / doc.tracks[0]!.timescale, 1);
    }
  });
}
