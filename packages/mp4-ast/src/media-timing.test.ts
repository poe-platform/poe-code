import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4, sliceMp4, serializeMpegTs, parseMpegTs } from "./index.js";

function clip() {
  return parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 25, frameCount: 50, includeAudio: true }));
}

it("slicing at or beyond EOF and empty intervals produces no samples", () => {
  for (const useEditList of [false, true]) {
    for (const startSeconds of [clip().durationSeconds, 2.1, 10]) {
      const sliced = sliceMp4(clip(), { startSeconds, useEditList });
      assert.equal(sliced.durationSeconds, 0);
      assert.equal(parseMp4(serializeMp4(sliced)).durationSeconds, 0);
      assert.ok(sliced.tracks.every(t => t.samples.length === 0));
    }
    const sliced = sliceMp4(clip(), { startSeconds: 1, endSeconds: 1, useEditList });
    assert.ok(sliced.tracks.every(t => t.samples.length === 0));
  }
});

it("non-keyframe trims preserve decode preroll with an accurate presentation interval", () => {
  const source = clip();
  const doc = { ...source, tracks: source.tracks.map(t => t.type === "video" ? {
    ...t, samples: t.samples.map((s, i) => ({ ...s, isKeyframe: i === 0 }))
  } : t) };
  const sliced = sliceMp4(doc, { startSeconds: 1, durationSeconds: 0.5 });
  const video = sliced.tracks.find(t => t.type === "video")!;
  assert.equal(video.samples[0]!.isKeyframe, true);
  assert.equal(video.editList?.[0]?.mediaTime, video.timescale);
  assert.equal(sliced.durationSeconds, 0.5);
  assert.equal(parseMp4(serializeMp4(sliced)).durationSeconds, 0.5);
});

it("MPEG-TS preserves 33-bit PTS/DTS at large broadcast epochs", () => {
  const source = clip();
  for (const epoch of [2 ** 29, 2 ** 30, 2 ** 32, 2 ** 33 - 900000]) {
    const video = source.tracks.find(t => t.type === "video")!;
    const track = { ...video, timescale: 90000, samples: video.samples.slice(0, 2).map((s, i) => ({
      ...s, dts: epoch + i * 3600, pts: epoch + i * 3600 + 1800, cts: 1800, duration: 3600
    })) };
    const parsed = parseMpegTs(serializeMpegTs({ ...source, tracks: [track] }));
    assert.equal(parsed.tracks[0]!.samples[0]!.dts, 0);
    assert.equal(parsed.tracks[0]!.samples[0]!.pts, 1800);
    assert.equal(parsed.tracks[0]!.samples[1]!.dts, 3600);
  }
});

it("successive trims use the existing edit-list presentation origin", () => {
  const source = clip();
  const doc = { ...source, tracks: source.tracks.map(t => t.type === "video" ? {
    ...t, samples: t.samples.map((s, i) => ({ ...s, isKeyframe: i === 0 }))
  } : t) };
  const first = sliceMp4(doc, { startSeconds: 1, durationSeconds: 0.8 });
  const second = sliceMp4(first, { startSeconds: 0.2, durationSeconds: 0.3 });
  const video = second.tracks.find(t => t.type === "video")!;
  assert.equal(video.editList?.[0]?.mediaTime, video.timescale * 1.2);
  assert.equal(second.durationSeconds, 0.3);
});
