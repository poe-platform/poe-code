import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, parseMp4Boxes, serializeMp4 } from "./mp4.js";

for (const fragmented of [false, true]) {
  for (const faststart of [false, true]) {
    for (const rawEntry of [false, true]) {
      it(`writes colr without changing samples (fragmented=${fragmented}, faststart=${faststart}, rawEntry=${rawEntry})`, () => {
        const base = parseMp4(createSyntheticMp4({ frameCount: 2, includeAudio: false }));
        const doc = { ...base, tracks: base.tracks.map(track => ({ ...track,
          codecDescriptions: track.codecDescriptions.map(codec => ({ ...codec,
            rawStsdEntryBytes: rawEntry ? codec.rawStsdEntryBytes : undefined
          }))
        })) };
        const bytes = serializeMp4(doc, { writeColr: true, fragmented, faststart });
        const parsed = parseMp4(bytes);
        const entry = parsed.tracks[0]!.codecDescriptions[0]!.rawStsdEntryBytes!;
        const boxes = parseMp4Boxes(entry.subarray(86)).filter(box => box.type === "colr");
        assert.equal(boxes.length, 1);
        assert.equal(boxes[0]!.size, 19);
        assert.deepEqual(Array.from(boxes[0]!.payload), [110, 99, 108, 120, 0, 2, 0, 2, 0, 2, 0]);
        assert.deepEqual(parsed.tracks[0]!.samples.map(s => s.data), base.tracks[0]!.samples.map(s => s.data));
        // Existing color information must survive without duplication or replacement.
        boxes[0]!.payload.set([0, 1, 0, 1, 0, 1, 128], 4);
        for (const writeColr of [false, true]) {
          const copied = parseMp4(serializeMp4(parsed, { writeColr, fragmented, faststart }));
          const copiedEntry = copied.tracks[0]!.codecDescriptions[0]!.rawStsdEntryBytes!;
          const copiedBoxes = parseMp4Boxes(copiedEntry.subarray(86)).filter(box => box.type === "colr");
          assert.deepEqual(copiedBoxes.map(box => box.payload), [boxes[0]!.payload]);
        }
      });
    }
  }
}
