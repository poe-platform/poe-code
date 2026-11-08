import assert from "node:assert/strict";
import { it } from "node:test";
import { assAst } from "./containers/ass.js";
import { parseSubtitleDocument, serializeSubtitleDocument } from "./containers/adapters.js";

const srt = "1\n00:00:01,250 --> 00:00:03,500\nHello\nworld\n\n2\n00:59:59,999 --> 01:00:00,000\nboundary\n\n3\n01:02:03,400 --> 01:02:04,500\nthere\n\n";
const vtt = "WEBVTT\n\n00:01.250 --> 00:03.500\nHello\nworld\n\n59:59.999 --> 01:00:00.000\nboundary\n\n01:02:03.400 --> 01:02:04.500\nthere\n";

for (const [inputFormat, input] of [["srt", srt], ["webvtt", vtt]] as const) {
  for (const [outputFormat, expected] of [["srt", srt], ["webvtt", vtt]] as const) {
    it(`serializes ${inputFormat} to native ${outputFormat} bytes with multiline and hour boundaries`, () => {
      const doc = parseSubtitleDocument(new TextEncoder().encode(input), inputFormat);
      assert.deepEqual(serializeSubtitleDocument(doc, outputFormat), new TextEncoder().encode(expected));
    });
  }
}

it("does not add an SRT separator without cues", () => {
  const doc = parseSubtitleDocument(new TextEncoder().encode("WEBVTT\n"), "webvtt");
  assert.equal(serializeSubtitleDocument(doc, "srt").byteLength, 0);
});

for (const newline of ["\n", "\r\n"]) {
  it(`preserves ASS trailing spaces in SRT with ${JSON.stringify(newline)} input`, () => {
    const input = [
      "[Script Info]", "ScriptType: v4.00+", "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 3,0:00:01.00,0:00:03.00,Default,Actor,0010,0020,0030,,  leading and trailing  ", ""
    ].join(newline);
    const doc = assAst().parse(new TextEncoder().encode(input));
    assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "srt")),
      "1\n00:00:01,000 --> 00:00:03,000\nleading and trailing  \n\n");
  });
}
