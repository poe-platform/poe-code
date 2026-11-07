import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, serializeMkv } from "./containers/mkv.js";

// FFmpeg 9: testsrc2=s=32x24:r=5:d=1 + sine=f=440:r=48000:d=1,
// encoded with libvpx-vp9 (threads=1) and libopus.
const fixture = new Uint8Array(readFileSync(new URL("./fixtures/opus-delay.webm", import.meta.url)));

it("reads Opus delay and preroll and exposes delay-adjusted packet timestamps", () => {
  const doc = parseMkv(fixture);
  const audio = doc.tracks.find(track => track.type === "audio")!;
  assert.equal(audio.codecDelayNs, 6_500_000);
  assert.equal(audio.seekPreRollNs, 80_000_000);
  assert.deepEqual(audio.samples.slice(0, 2).map(sample => sample.pts), [-7, 14]);
  assert.equal(doc.tracks[0]!.samples[0]!.pts, 0);
});

it("preserves Opus settings, packet payloads and A/V alignment through repeated copies", () => {
  const source = parseMkv(fixture);
  let copied = source;
  for (let i = 0; i < 2; i++) {
    copied = parseMkv(serializeMkv(copied));
    for (const [index, track] of copied.tracks.entries()) {
      const original = source.tracks[index]!;
      assert.equal(track.codecDelayNs, original.codecDelayNs);
      assert.equal(track.seekPreRollNs, original.seekPreRollNs);
      assert.deepEqual(track.samples.map(sample => [sample.pts, sample.data]),
        original.samples.map(sample => [sample.pts, sample.data]));
    }
  }
});
