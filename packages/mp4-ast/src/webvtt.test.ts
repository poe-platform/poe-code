import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument, serializeSubtitleDocument } from "./containers/adapters.js";

it("round-trips WebVTT cue side data and multiline captions with CRLF input", () => {
  const input = "WEBVTT\n\ncue α\n00:00:01.250 --> 00:00:03.500 align:start position:15%\nOne\nTwo\n\n00:00:05.000 --> 00:00:06.750 line:90%\nThree\n";
  const doc = parseSubtitleDocument(new TextEncoder().encode(input.replaceAll("\n", "\r\n")), "webvtt");
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => sample.webvtt), [
    { identifier: "cue α", settings: "align:start position:15%" },
    { identifier: "", settings: "line:90%" }
  ]);
  assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "webvtt")), input);
  assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "srt")),
    "1\n00:00:01,250 --> 00:00:03,500\nOne\nTwo\n\n2\n00:00:05,000 --> 00:00:06,750\nThree\n");
});
