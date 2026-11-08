import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument } from "./containers/adapters.js";

const first = "1\n00:00:01,000 --> 00:00:03,500\nCafé costs €2\n\n";
const second = "2\n00:00:02,250 --> 00:00:05,000\nSecond line\n\n";

for (const [name, input, expected] of [
  ["identical cues", first + first + second, [[1000, 2500, "Café costs €2"], [2250, 2750, "Second line"]]],
  ["separated duplicates with different cue numbers", first + second + first.replace("1\n", "3\n"), [[1000, 2500, "Café costs €2"], [2250, 2750, "Second line"]]],
  ["different text", first.replace("Café costs €2", "Other text") + first + second, [[1000, 2500, "Other text"], [1000, 2500, "Café costs €2"], [2250, 2750, "Second line"]]],
  ["different end", first.replace("03,500", "03,600") + first + second, [[1000, 2600, "Café costs €2"], [1000, 2500, "Café costs €2"], [2250, 2750, "Second line"]]],
  ["different start", first.replace("01,000", "00,900") + first + second, [[900, 2600, "Café costs €2"], [1000, 2500, "Café costs €2"], [2250, 2750, "Second line"]]],
  ["ordinary UTF-8", first + second, [[1000, 2500, "Café costs €2"], [2250, 2750, "Second line"]]]
] as const) {
  it(`SubRip cue deduplication: ${name}`, () => {
    const doc = parseSubtitleDocument(new TextEncoder().encode(input), "srt");
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [
      sample.pts, sample.duration, new TextDecoder().decode(sample.data)
    ]), expected);
  });
}
