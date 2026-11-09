import assert from "node:assert/strict";
import { it } from "node:test";
import { assAst } from "./containers/ass.js";
import { decodeUtf8, encodeUtf8 } from "./binary.js";

it("resolves ASS bold styles by declared fields and exact event style name", () => {
  const source = encodeUtf8([
    "[Script Info]", "ScriptType: v4.00+", "[V4+ Styles]",
    "Format: Bold, Name", "Style: -1,Speaker", "Style: 0,Plain", "Style: -1,Default",
    "[Events]", "Format: Start, End, Style, Text",
    ...["Speaker", "Plain", "Default", "Missing", "speaker"].map(style =>
      `Dialogue: 0:00:01.00,0:00:02.00,${style},${style}`)
  ].join("\n") + "\n");
  const plugin = assAst();
  const decoded = plugin.parse(source);
  assert.deepEqual(decoded.tracks[0]!.samples.map(sample => decodeUtf8(sample.data)),
    ["<b>Speaker</b>", "Plain", "<b>Default</b>", "Missing", "speaker"]);
  assert.deepEqual(plugin.serialize(plugin.parse(source, { decodeSubtitles: false })), source);
});
