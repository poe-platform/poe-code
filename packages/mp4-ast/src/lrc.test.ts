import assert from "node:assert/strict";
import { it } from "node:test";
import { lrcAst } from "./containers/lrc.js";
import { allMediaAsts, createMediaAstRegistry, parseSubtitleDocument } from "./containers/adapters.js";

it("detects lyrics without an extension and sorts cues while skipping metadata and invalid timestamps", () => {
  const bytes = new TextEncoder().encode("[ar:Artist]\r\n[00:03.40]Café & final\r\n[bad:time]No\r\n[:1]No\r\n[00:01.24]First\r\n");
  const plugin = createMediaAstRegistry(allMediaAsts()).detect(bytes, "input.bin");
  assert.equal(plugin?.id, "lrc");
  const doc = plugin!.parse(bytes);
  assert.deepEqual(doc.tracks[0]!.samples.map(s => [s.pts, s.duration, new TextDecoder().decode(s.data)]),
    [[1240, 2160, "First"], [3400, 0, "Café & final"]]);
  assert.equal(lrcAst().detect(new TextEncoder().encode("[ar:Artist]\n[00:no]Invalid\n")), false);
});

it("uses the subtitle track timescale when writing centisecond lyrics", () => {
  const doc = parseSubtitleDocument(new TextEncoder().encode("1\n00:01:01,240 --> 00:01:03,000\nFirst\nSecond\n"), "srt");
  const track = doc.tracks[0]!;
  const scaled = { ...doc, tracks: [{ ...track, timescale: 10000,
    samples: track.samples.map(s => ({ ...s, pts: s.pts * 10, duration: s.duration * 10 })) }] };
  assert.equal(new TextDecoder().decode(lrcAst().serialize(scaled)), "\n[01:01.24]First\n[01:01.24]Second\n");
});

for (const [start, expected] of [
  ["00:01.004", "00:01.00"],
  ["00:01.005", "00:01.01"],
  ["00:01.006", "00:01.01"],
  ["00:01.015", "00:01.02"],
  ["00:01.999", "00:02.00"],
  ["00:59.995", "01:00.00"]
]) {
  for (const timescale of [1000, 90000]) {
    it(`rounds WebVTT ${start} to LRC ${expected} at timescale ${timescale}`, () => {
      const doc = parseSubtitleDocument(new TextEncoder().encode(
        `WEBVTT\n\n${start} --> 01:01.000\nhello\n\n`
      ), "webvtt");
      const track = doc.tracks[0]!;
      const scaled = { ...doc, tracks: [{ ...track, timescale,
        samples: track.samples.map(sample => ({ ...sample, pts: sample.pts * timescale / track.timescale })) }] };
      const output = new TextDecoder().decode(lrcAst().serialize(scaled));
      assert.deepEqual(output.split("\n").filter(line => line.endsWith("hello")), [`[${expected}]hello`]);
    });
  }
}
