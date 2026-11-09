import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument, serializeSubtitleDocument } from "./containers/adapters.js";

for (const [settings, expected] of [
  ["X1:10 X2:50 Y1:20 Y2:60", "  X1:010 X2:050 Y1:020 Y2:060"],
  ["X1:0 X2:0 Y1:0 Y2:0", "  X1:000 X2:000 Y1:000 Y2:000"],
  ["X1:10 X2:50", "  X1:010 X2:050 Y1:-01 Y2:-01"],
  ["X1:-1 X2:50 Y1:20 Y2:60", ""],
  ["", ""]
]) {
  it(`round-trips SubRip positioning: ${settings || "absent"}`, () => {
    const input = `1\n00:00:01,000 --> 00:00:02,000 ${settings}\nalpha\n\n2\n00:00:03,000 --> 00:00:04,000\nbeta\n`;
    const doc = parseSubtitleDocument(new TextEncoder().encode(input), "srt");
    assert.equal(doc.tracks[0]!.samples[1]!.subtitlePosition, undefined);
    const output = new TextDecoder().decode(serializeSubtitleDocument(doc, "srt"));
    assert.equal(output.trimEnd(), `1\n00:00:01,000 --> 00:00:02,000${expected}\nalpha\n\n2\n00:00:03,000 --> 00:00:04,000\nbeta`);
    assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "webvtt")).includes("X1:"), false);
  });
}
