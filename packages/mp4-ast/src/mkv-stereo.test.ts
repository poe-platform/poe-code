import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, serializeMkv } from "./containers/mkv.js";

// Native FFmpeg: testsrc2=s=32x24:r=5:d=1, libvpx-vp9,
// -metadata:s:v:0 stereo_mode=left_right.
const fixture = readFileSync(new URL("./fixtures/vp9-stereo.webm", import.meta.url));

for (const format of ["webm", "matroska"]) {
  it(`${format} retains native StereoMode and coded samples`, () => {
    const source = parseMkv(new Uint8Array(fixture));
    assert.equal(source.tracks[0]!.codecDescriptions[0]!.stereoMode, 1);
    const copied = parseMkv(serializeMkv(source, { format }));
    assert.equal(copied.tracks[0]!.codecDescriptions[0]!.stereoMode, 1);
    assert.deepEqual(copied.tracks[0]!.samples.map(sample => sample.data),
      source.tracks[0]!.samples.map(sample => sample.data));
  });

  for (const stereoMode of [undefined, ...Array.from({ length: 15 }, (_, i) => i)]) {
    it(`${format} preserves StereoMode ${stereoMode ?? "absence"}`, () => {
      const source = parseMkv(new Uint8Array(fixture));
      const track = source.tracks[0]!;
      const modified = { ...source, tracks: [{ ...track, codecDescriptions: [
        { ...track.codecDescriptions[0]!, stereoMode }
      ] }] };
      const copied = parseMkv(serializeMkv(modified, { format }));
      assert.equal(copied.tracks[0]!.codecDescriptions[0]!.stereoMode, stereoMode);
    });
  }
}
