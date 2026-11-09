import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument } from "./containers/adapters.js";

const first = "1\n00:00:01,000 --> 00:00:02,000\n";
const second = "\n2\n00:00:01,500 --> 00:00:03,000\n";
const cases = [
  ["NUL inside first dialogue", first + "hi\0hidden\n" + second + "beta\n", []],
  ["NUL inside second dialogue", first + "alpha\n" + second + "be\0ta\n", ["alpha"]],
  ["NUL on following line", first + "alpha\n\0\n", ["alpha"]],
  ["complete input", first + "alpha\n" + second + "beta\n", ["alpha", "beta"]]
] as const;

for (const [name, input, expected] of cases) {
  it(`SubRip demux boundary: ${name}`, () => {
    const doc = parseSubtitleDocument(new TextEncoder().encode(input), "srt");
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => new TextDecoder().decode(sample.data)), expected);
  });
}
