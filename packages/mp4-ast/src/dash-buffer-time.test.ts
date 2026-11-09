import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeDashDocument } from "./index.js";

for (const [segmentDuration, frameCount, keyframeInterval, expected] of [
  [0.5, 20, 4, 2],
  [1, 20, 4, 2],
  [2, 20, 4, 4],
  [5, 3, 4, 1.5],
  [0.25, 7, 1, 0.5]
] as const) {
  for (const options of [{}, { useTemplate: false }, { singleFile: true }, { windowSize: 1 }, { fragmentType: "every_frame" as const }]) {
    it(`derives DASH buffer time from emitted timing: ${JSON.stringify({ segmentDuration, frameCount, keyframeInterval, options })}`, () => {
      const source = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount, includeAudio: false }));
      const doc = { ...source, tracks: source.tracks.map(track => ({
        ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % keyframeInterval === 0 }))
      })) };
      const { manifest } = serializeDashDocument(doc, { segmentDuration, ...options });
      const xml = new TextDecoder().decode(manifest);
      const value = xml.split('minBufferTime="PT')[1]!.split('S"')[0]!;
      assert.equal(Number(value), expected);
    });
  }
}

it("uses the latest completed video segment despite longer audio segments and an earlier long GOP", () => {
  const source = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 21, includeAudio: true }));
  const doc = { ...source, tracks: source.tracks.map(track => ({
    ...track, samples: track.samples.map((sample, index) => ({
      ...sample, isKeyframe: track.type === "audio" || [0, 8, 12, 16, 20].includes(index)
    }))
  })) };
  const { manifest } = serializeDashDocument(doc, { segmentDuration: 1 });
  assert.ok(new TextDecoder().decode(manifest).includes('minBufferTime="PT2.000000S"'));
});

it("derives audio-only DASH buffer time in the audio timescale", () => {
  const source = parseMp4(createSyntheticMp4({ includeAudio: true, sampleRate: 8000 }));
  const audio = source.tracks.find(track => track.type === "audio")!;
  const doc = { ...source, tracks: [{ ...audio, timescale: 8000, samples: Array.from({ length: 9 }, (_, index) => ({
    ...audio.samples[0]!, dts: index * 2000, pts: index * 2000, duration: 2000
  })) }] };
  const { manifest } = serializeDashDocument(doc, { segmentDuration: 1 });
  assert.ok(new TextDecoder().decode(manifest).includes('minBufferTime="PT2.000000S"'));
});
