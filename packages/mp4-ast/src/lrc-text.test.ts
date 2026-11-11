import assert from "node:assert/strict";
import { it } from "node:test";
import { lrcAst } from "./containers/lrc.js";

// Text prefixes verified against native FFmpeg 7.0.2.
for (const [prefix, expected] of [
  ["   spaces   ", "spaces   "],
  ["\tword\t", "word\t"],
  [" [00:02.00] next", "next"],
  [" [chorus] line", "chorus] line"],
  ["my [chorus] line", "my [chorus] line"],
  ["[chorus] line", "chorus] line"],
  [" [12:34.56] [chorus] line", "chorus] line"],
  [" [[:.-12]] \tword  ", "word  "],
  ["\u00a0word", "\u00a0word"],
  ["123 words", "123 words"],
  ["] literal", "] literal"]
]) {
  it(`matches LRC displayed text after the timestamp: ${JSON.stringify(prefix)}`, () => {
    const doc = lrcAst().parse(new TextEncoder().encode(`[00:01.00]${prefix}\r\n[00:05.00]end\r\n`));
    const samples = doc.tracks[0]!.samples;
    assert.equal(samples.length, 2);
    assert.deepEqual(samples.map(sample => [sample.pts, new TextDecoder().decode(sample.data)]),
      [[1000, expected], [5000, "end"]]);
    assert.equal(samples[0]!.duration, 4000);
  });
}
