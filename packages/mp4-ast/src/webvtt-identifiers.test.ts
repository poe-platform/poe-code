import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument, serializeSubtitleDocument } from "./containers/adapters.js";

for (const preceding of ["", "id\n00:00.000 --> 00:00.500\nBefore\n\n"]) {
  it(`stops at surplus WebVTT identifiers, preceding cue=${Boolean(preceding)}`, () => {
    const input = `WEBVTT\n\n${preceding}first\nsecond\n00:01.000 --> 00:02.000\nHello\n\n00:03.000 --> 00:04.000\nGood\n`;
    const doc = parseSubtitleDocument(new TextEncoder().encode(input), "webvtt");
    assert.equal(doc.tracks[0]!.samples.length, preceding ? 1 : 0);
    assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "webvtt")),
      preceding ? `WEBVTT\n\n${preceding.trimEnd()}\n` : "WEBVTT\n");
  });
}

it("accepts a single WebVTT identifier and subsequent cues", () => {
  const input = "WEBVTT\n\nfirst\n00:01.000 --> 00:02.000\nHello\n\n00:03.000 --> 00:04.000\nGood\n";
  const doc = parseSubtitleDocument(new TextEncoder().encode(input), "webvtt");
  assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "webvtt")), input);
});
