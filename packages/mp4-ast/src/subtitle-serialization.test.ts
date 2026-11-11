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

for (const format of ["srt", "webvtt"] as const) {
  it(`serializes ASS soft and hard breaks to native ${format} payload bytes`, () => {
    const input = [
      "[Script Info]", "ScriptType: v4.00+", "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      String.raw`Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,A\nB\NC`,
      "Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,next", ""
    ].join("\n");
    const doc = assAst().parse(new TextEncoder().encode(input));
    const expected = format === "srt"
      ? "1\n00:00:01,000 --> 00:00:02,000\nA\r\nB\r\nC\n\n2\n00:00:03,000 --> 00:00:04,000\nnext\n\n"
      : "WEBVTT\n\n00:01.000 --> 00:02.000\nA\nB\nC\n\n00:03.000 --> 00:04.000\nnext\n";
    assert.deepEqual(serializeSubtitleDocument(doc, format), new TextEncoder().encode(expected));
  });
}

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

it("rescales SRT packet starts and durations separately from microseconds", () => {
  const doc = parseSubtitleDocument(new TextEncoder().encode("1\n00:00:03,000 --> 00:00:04,000\nA\n"), "srt");
  const track = doc.tracks[0]!;
  const packet = track.samples[0]!;
  const output = serializeSubtitleDocument({ ...doc, tracks: [{ ...track, timescale: 1_000_000,
    samples: [
      { ...packet, pts: 3_000_500, dts: 3_000_000, duration: 1_000_000 },
      { ...packet, pts: 5_000_500, dts: 5_000_000, duration: 1_000_500 }
    ]
  }] }, "srt");
  assert.equal(new TextDecoder().decode(output),
    "1\n00:00:03,001 --> 00:00:04,001\nA\n\n2\n00:00:05,001 --> 00:00:06,002\nA\n\n");
});
