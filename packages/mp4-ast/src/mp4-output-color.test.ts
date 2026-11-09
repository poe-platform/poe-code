import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, parseMp4Boxes, serializeMp4 } from "./mp4.js";

for (const rawEntry of [false, true]) {
  for (const fragmented of [false, true]) {
    it(`serializes explicit output color metadata (rawEntry=${rawEntry}, fragmented=${fragmented})`, () => {
      const original = parseMp4(createSyntheticMp4({ frameCount: 2, includeAudio: false }));
      const doc = { ...original, tracks: original.tracks.map(track => ({ ...track,
        codecDescriptions: track.codecDescriptions.map(codec => ({ ...codec,
          rawStsdEntryBytes: rawEntry ? codec.rawStsdEntryBytes : undefined,
          colorMetadata: { primaries: 9, transfer: 16, matrix: 9, range: 2 }
        }))
      })) };
      const parsed = parseMp4(serializeMp4(doc, { fragmented }));
      const entry = parsed.tracks[0]!.codecDescriptions[0]!.rawStsdEntryBytes!;
      assert.deepEqual(parseMp4Boxes(entry.subarray(86)).filter(box => box.type === "colr").map(box => Array.from(box.payload)),
        [[110, 99, 108, 120, 0, 9, 0, 16, 0, 9, 128]]);
      assert.deepEqual(parsed.tracks[0]!.samples.map(sample => sample.data), original.tracks[0]!.samples.map(sample => sample.data));
    });
  }
}
