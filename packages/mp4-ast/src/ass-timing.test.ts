import assert from "node:assert/strict";
import { it } from "node:test";
import { assAst } from "./containers/ass.js";
import { encodeUtf8 } from "./binary.js";

for (const [start, end, pts, duration] of [
  ["0:00:01.2", "0:00:03.4", 1020, 2020],
  ["0:00:01.234", "0:00:03.456", 3340, 4220],
  ["1:02:03.25", "1:02:04.50", 3723250, 1250],
  ["0:00:59.123", "0:01:02.004", 60230, 1810]
] as const) {
  for (const decodeSubtitles of [false, true]) {
    it(`reads ASS ${start} as centiseconds, decodeSubtitles=${decodeSubtitles}`, () => {
      const plugin = assAst();
      const bytes = encodeUtf8(`[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 3,${start},${end},Default,Actor,0010,0020,0030,,Timed\n`);
      const doc = plugin.parse(bytes, { decodeSubtitles });
      const sample = doc.tracks[0]!.samples[0]!;
      assert.equal(sample.pts, pts);
      assert.equal(sample.duration, duration);
      assert.equal(doc.duration, pts + duration);
      const restored = plugin.parse(plugin.serialize(doc), { decodeSubtitles });
      assert.equal(restored.tracks[0]!.samples[0]!.pts, pts);
      assert.equal(restored.tracks[0]!.samples[0]!.duration, duration);
    });
  }
}

for (const timescale of [1000, 90000]) {
  it(`rounds ASS start and duration separately at timescale ${timescale}`, () => {
    const plugin = assAst();
    const doc = plugin.parse(encodeUtf8("[Script Info]\n[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,Timed\n"));
    const track = doc.tracks[0]!;
    const samples = [[1006, 1013], [3004, 1001], [5005, 1005], [59996, 5], [3599996, 5]].map(([pts, duration]) => ({
      ...track.samples[0]!, pts: pts! * timescale / 1000, duration: duration! * timescale / 1000
    }));
    const output = new TextDecoder().decode(plugin.serialize({ ...doc, tracks: [{ ...track, timescale, samples }] }));
    assert.deepEqual(output.split("\n").filter(line => line.startsWith("Dialogue:")).map(line => line.split(",").slice(1, 3)), [
      ["0:00:01.01", "0:00:02.02"], ["0:00:03.00", "0:00:04.00"],
      ["0:00:05.01", "0:00:06.02"], ["0:01:00.00", "0:01:00.01"], ["1:00:00.00", "1:00:00.01"]
    ]);
  });
}
