import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "./mp4.js";

for (const fragmented of [false, true]) {
  for (const view of ["whole", "alias", "partial"]) {
    it(`preserves borrowed pixels across repeated frames, tracks and serialization (fragmented=${fragmented}, view=${view})`, () => {
      const source = parseMp4(createSyntheticMp4({ width: 4, height: 4, frameCount: 1 }), { decodeFrames: true });
      const track = source.tracks[0]!;
      const frame = track.decodedVideoFrames![0]!;
      const offset = view === "partial" ? 4 : 0;
      const backing = new Uint8Array(frame.data.length + offset * 2).fill(173);
      backing.set(frame.data, offset);
      const pixels = backing.subarray(offset, offset + frame.data.length);
      const before = backing.slice();
      const frames = Array.from({ length: 3 }, (_, index) => ({
        ...frame, data: view === "whole" ? pixels : pixels.subarray(),
        ptsSeconds: index * frame.durationSeconds
      }));
      const document = { ...source, tracks: [1, 2].map(id => ({
        ...track, id, samples: [], decodedVideoFrames: frames,
        duration: track.duration * 3
      })) };
      const bytes = serializeMp4(document, { fragmented });
      const decoded = parseMp4(bytes, { decodeFrames: true });
      const first = decoded.tracks[0]!.decodedVideoFrames![0]!.data;
      assert.ok(first.some((value, index) => index % 4 !== 3 && value > 32));
      for (const output of decoded.tracks) {
        assert.equal(output.decodedVideoFrames!.length, 3);
        for (const picture of output.decodedVideoFrames!) assert.deepEqual(picture.data, first);
      }
      assert.deepEqual(backing, before);
      assert.deepEqual(serializeMp4(document, { fragmented }), bytes);
    });
  }
}
