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
