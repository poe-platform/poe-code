import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument, serializeSubtitleDocument } from "./containers/adapters.js";

for (const [name, input, dialogue] of [
  [
    "leading and trailing spaces",
    "1\n00:00:01,000 --> 00:00:02,000\n  alpha  \n\t indented \t\n",
    [
      "  alpha  \n\t indented \t"
    ]
  ],
  [
    "whitespace dialogue before next cue",
    "1\n00:00:01,000 --> 00:00:02,000\nalpha\n \t \n2\n00:00:01,500 --> 00:00:03,000\nbeta\n",
    [
      "alpha\n \t ",
      "beta"
    ]
  ],
  [
    "multiline control",
    "1\n00:00:01,000 --> 00:00:02,000\nfirst\nsecond\n",
    [
      "first\nsecond"
    ]
  ]
] as const) {
  for (const newline of ["\n", "\r\n"]) {
    it(`preserves SRT packet whitespace: ${name}, ${JSON.stringify(newline)}`, () => {
      const doc = parseSubtitleDocument(new TextEncoder().encode(input.replaceAll("\n", newline)), "srt");
      assert.deepEqual(doc.tracks[0]!.samples.map(sample => new TextDecoder().decode(sample.data)), dialogue);
      const output = new TextDecoder().decode(serializeSubtitleDocument(doc, "srt"));
      const expected = dialogue.map((text, index) => `${index + 1}\n${index === 0 ? "00:00:01,000 --> 00:00:02,000" : "00:00:01,500 --> 00:00:03,000"}\n${text}\n\n`).join("");
      assert.equal(output, expected);
    });
  }
}
