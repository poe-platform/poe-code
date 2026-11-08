import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, dashAst, parseMp4, serializeMp4 } from "./index.js";

it("preserves DASH media edits across representation movie timescales", () => {
  const source = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 12, includeAudio: true, sampleRate: 8000 }));
  const resources = new Map<string, Uint8Array>();
  for (const track of source.tracks) {
    const audio = track.type === "audio";
    const timescale = audio ? 8000 : 16384;
    const count = audio ? 25 : 12;
    const duration = audio ? 1024 : 4096;
    resources.set(`${track.id}.mp4`, serializeMp4({ ...source, timescale,
      tracks: [{ ...track, timescale, samples: Array.from({ length: count }, (_, i) => ({
        ...track.samples[0]!, dts: i * duration, pts: i * duration, cts: 0,
        duration: audio && i === 24 ? 448 : duration
      })), editList: [{ segmentDuration: 0, mediaTime: audio ? 1024 : 0, mediaRateInteger: 1, mediaRateFraction: 0 }] }]
    }, { fragmented: true }));
  }
  const manifest = new TextEncoder().encode(`<MPD mediaPresentationDuration="PT3S"><Period><AdaptationSet>${source.tracks.map(track =>
    `<Representation id="${track.id}"><BaseURL>${track.id}.mp4</BaseURL></Representation>`).join("")}</AdaptationSet></Period></MPD>`);
  const doc = dashAst().parse(manifest, { resolveResource: uri => resources.get(uri)! });
  assert.equal(doc.tracks[0]!.samples.length, 12);
  assert.equal(doc.tracks[1]!.samples.length, 25);
  assert.equal(doc.tracks[1]!.samples.at(-1)!.pts, 24576);
  assert.equal(doc.tracks[1]!.editList![0]!.mediaTime, 1024);
  assert.equal(doc.tracks[1]!.editList![0]!.segmentDuration / doc.timescale, 3);
});
