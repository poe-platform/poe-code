import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument } from "./containers/adapters.js";

const voices = "WEBVTT\n\na\n00:01.250 --> 00:02.750 align:start\nOne\nTwo\n\n00:04.000 --> 00:04.500\nThree\n";

for (const [name, input, positions] of [
  ["original", voices, [55, 85]],
  ["CRLF", voices.replaceAll("\n", "\r\n"), [62, 94]],
  ["no final newline", voices.slice(0, -1), [55, 84]],
  ["extra blank lines", voices.replace("Two\n\n", "Two\n\n\n\n") + "\n\n", [55, 88]],
  ["BOM and UTF-8", "\uFEFF" + voices.replace("One", "Oné"), [59, 89]],
  ["sorted cues", voices.replace("01.250", "09.250").replace("02.750", "10.750"), [85, 55]],
  ["skipped note", voices.replace("\na\n", "\nNOTE comment\n\na\n"), [69, 99]],
] as const) {
  it(`retains native WebVTT packet positions: ${name}`, () => {
    const bytes = new TextEncoder().encode(input);
    const samples = parseSubtitleDocument(bytes, "webvtt").tracks[0]!.samples;
    assert.deepEqual(samples.map(sample => sample.offset), positions);
    assert.deepEqual(samples.map(sample => sample.size), name === "sorted cues" ? [5, 7] : name === "BOM and UTF-8" ? [8, 5] : [7, 5]);
  });
}
