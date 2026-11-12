import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument, serializeSubtitleDocument } from "./containers/adapters.js";

// Native FFmpeg drops initial ASCII spaces, but preserves trailing spaces and tabs.
for (const [label, dialogue, expected] of [
  ["trailing spaces", "Last  ", "Last  "],
  ["edge tabs", "\tFirst\t", "\tFirst\t"],
  ["leading spaces", "  First", "First"]] as const) {
  it(`preserves native WebVTT ${label} when writing SRT`, () => {
    const input = `WEBVTT\n\n00:01.250 --> 00:03.500\n${dialogue}\n\n`;
    const document = parseSubtitleDocument(new TextEncoder().encode(input), "webvtt");
    assert.deepEqual(serializeSubtitleDocument(document, "srt"),
      new TextEncoder().encode(`1\n00:00:01,250 --> 00:00:03,500\n${expected}\n\n`));
  });
}
