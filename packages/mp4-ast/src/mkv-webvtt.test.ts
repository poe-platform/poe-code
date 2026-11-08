import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument, serializeSubtitleDocument } from "./containers/adapters.js";
import { parseMkv, serializeMkv } from "./containers/mkv.js";

const input = "WEBVTT\n\nscene-A\n00:00.250 --> 00:01.125 align:end position:80%\nFirst line\n\nscene-B\n00:01.750 --> 00:03.500 line:10%\nSecond line\n";
for (const webm of [false, true]) {
  for (const sideData of [false, true]) {
    it(`writes interoperable WebVTT packets, webm=${webm}, sideData=${sideData}`, () => {
      const original = parseSubtitleDocument(Buffer.from(input), "webvtt");
      const doc = { ...original, tracks: original.tracks.map(track => ({ ...track,
        samples: track.samples.map(sample => sideData ? sample : { ...sample, webvtt: undefined })
      })) };
      const bytes = serializeMkv(doc, { webm });
      assert.ok(Buffer.from(bytes).includes(Buffer.from("D_WEBVTT/SUBTITLES")));
      assert.ok(Buffer.from(bytes).includes(Buffer.from(sideData ? "scene-A\nalign:end position:80%\nFirst line" : "\n\nFirst line")));
      const parsed = parseMkv(bytes);
      assert.equal(parsed.tracks[0]!.codecDescriptions[0]!.codecName, "webvtt");
      assert.deepEqual(parsed.tracks[0]!.samples.map(s => [s.pts, s.duration, Buffer.from(s.data).toString(), s.webvtt]), [
        [250, 875, "First line", { identifier: sideData ? "scene-A" : "", settings: sideData ? "align:end position:80%" : "" }],
        [1750, 1750, "Second line", { identifier: sideData ? "scene-B" : "", settings: sideData ? "line:10%" : "" }]
      ]);
      assert.equal(Buffer.from(serializeSubtitleDocument(parsed, "webvtt")).toString(),
        Buffer.from(serializeSubtitleDocument(doc, "webvtt")).toString());
    });
  }
}
