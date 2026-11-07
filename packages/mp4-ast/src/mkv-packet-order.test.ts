import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, serializeMkv } from "./containers/mkv.js";

// ffmpeg -f lavfi -i testsrc2=size=32x24:rate=5:duration=1 -vf setsar=2 -c:v libx264 -threads 1
const fixture = new Uint8Array(readFileSync(new URL("./fixtures/h264-b-frames.mkv", import.meta.url)));

it("preserves H.264 B-frame packet order, timestamps and payloads", () => {
  const source = parseMkv(fixture);
  assert.deepEqual(source.tracks[0]!.samples.map(sample => sample.pts), [0, 600, 200, 400, 800]);
  const copied = parseMkv(serializeMkv(source));
  const packets = (doc: typeof source) => doc.tracks.map(track => track.samples.map(sample => ({
    pts: sample.pts, data: sample.data, isKeyframe: sample.isKeyframe
  })));
  assert.deepEqual(packets(copied), packets(source));
});

it("preserves per-track order across interleaving and backwards cluster boundaries", () => {
  const source = parseMkv(fixture);
  const original = source.tracks[0]!;
  const tracks = [original, { ...original, id: 2 }].map((track, index) => ({
    ...track,
    samples: track.samples.map((sample, i) => ({
      ...sample,
      pts: [0, 60000, 200, 400, 800][i]! + index * 100,
      dts: i * 200 + index * 100
    }))
  }));
  const copied = parseMkv(serializeMkv({ ...source, tracks }));
  for (let i = 0; i < tracks.length; i++) {
    assert.deepEqual(copied.tracks[i]!.samples.map(sample => [sample.pts, sample.data]),
      tracks[i]!.samples.map(sample => [sample.pts, sample.data]));
  }
});
