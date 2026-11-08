import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { muxMp4, parseMp4, serializeMp4 } from "./mp4.js";

// ffmpeg -f lavfi -i testsrc2=size=32x24:rate=25:duration=0.4
//   -c:v libx264 -g 1 -timecode 01:02:03:04 timecode.mp4
const fixture = new Uint8Array(readFileSync(new URL("./fixtures/timecode.mp4", import.meta.url)));

it("reads the native video-to-timecode track reference", () => {
  const doc = parseMp4(fixture);
  assert.equal(doc.tracks[0]!.timecodeTrackId, doc.tracks[1]!.id);
});

for (const fragmented of [false, true]) {
  for (const faststart of [false, true]) {
    it(`preserves and remaps timecode references (fragmented=${fragmented}, faststart=${faststart})`, () => {
      const doc = parseMp4(fixture);
      const reordered = muxMp4([{ ...doc, tracks: [...doc.tracks].reverse() }]);
      const output = parseMp4(serializeMp4(reordered, { fragmented, faststart }));
      const video = output.tracks.find(track => track.type === "video")!;
      const timecode = output.tracks.find(track => track.handlerType === "tmcd")!;
      assert.equal(timecode.id, 1);
      assert.equal(video.timecodeTrackId, timecode.id);
      assert.equal(video.samples.length, 10);
      assert.equal(timecode.samples.length, 1);
      assert.deepEqual(timecode.samples[0]!.data, doc.tracks[1]!.samples[0]!.data);
    });
  }
}

it("omits references to removed timecode tracks", () => {
  const doc = parseMp4(fixture);
  const output = parseMp4(serializeMp4({ ...doc, tracks: [doc.tracks[0]!] }));
  assert.equal(output.tracks[0]!.timecodeTrackId, undefined);
});
