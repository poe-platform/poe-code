import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument, serializeSubtitleDocument } from "./containers/adapters.js";

it("round-trips WebVTT cue side data and multiline captions with CRLF input", () => {
  const input = "WEBVTT\n\ncue α\n00:01.250 --> 00:03.500 align:start position:15%\nOne\nTwo\n\n00:05.000 --> 00:06.750 line:90%\nThree\n";
  const doc = parseSubtitleDocument(new TextEncoder().encode(input.replaceAll("\n", "\r\n")), "webvtt");
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => sample.webvtt), [
    { identifier: "cue α", settings: "align:start position:15%" },
    { identifier: "", settings: "line:90%" }
  ]);
  assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "webvtt")), input);
  assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "srt")),
    "1\n00:00:01,250 --> 00:00:03,500\nOne\nTwo\n\n2\n00:00:05,000 --> 00:00:06,750\nThree\n\n");
});

for (const block of ["STYLE", "REGION"]) {
  it(`skips WebVTT ${block} blocks without dropping later cues or ordinary identifiers`, () => {
    const good = "00:03.000 --> 00:04.000\nGood\n\nregion1\n00:05.000 --> 00:06.000\nCaption\n\nSTYLE1\n00:07.000 --> 00:08.000\nAnother\n";
    const input = `WEBVTT\n\n${block}\n00:01.000 --> 00:02.000\nHello\n\n${good}`;
    const doc = parseSubtitleDocument(new TextEncoder().encode(input), "webvtt");
    assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "webvtt")), `WEBVTT\n\n${good}`);
  });
}

for (const newline of ["\n", "\r\n"]) {
  it(`preserves WebVTT dialogue whitespace with ${JSON.stringify(newline)} line endings`, () => {
    const dialogue = "  one  \n two  ";
    const input = `WEBVTT\n\n00:01.000 --> 00:02.000\n${dialogue}\n`;
    const doc = parseSubtitleDocument(new TextEncoder().encode(input.replaceAll("\n", newline)), "webvtt");
    const sample = doc.tracks[0]!.samples[0]!;
    assert.equal(new TextDecoder().decode(sample.data), dialogue);
    assert.equal(sample.size, 14);
    assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "webvtt")), input);
  });
}

for (const settings of ["position:30%  ", "align:end\t", "position:30%", "line:2\talign:end"]) {
  for (const newline of ["\n", "\r\n"]) {
    it(`preserves WebVTT settings ${JSON.stringify(settings)} with ${JSON.stringify(newline)} line endings`, () => {
      const expected = `WEBVTT\n\ncue-1\n00:01.250 --> 00:03.500 ${settings}\nHi\n`;
      const input = (expected + "\n").replaceAll("\n", newline);
      const doc = parseSubtitleDocument(new TextEncoder().encode(input), "webvtt");
      assert.deepEqual(doc.tracks[0]!.samples[0]!.webvtt, { identifier: "cue-1", settings });
      assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "webvtt")), expected);
    });
  }
}
