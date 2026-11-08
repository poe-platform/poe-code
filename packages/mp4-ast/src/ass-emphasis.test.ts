import assert from "node:assert/strict";
import { it } from "node:test";
import { assAst } from "./containers/ass.js";
import { decodeUtf8, encodeUtf8 } from "./binary.js";

for (const [text, expected] of [
  [String.raw`A{\i1}I{\i0}B{\b1}B{\b0}U{\u1}U{\u0}Z`, "A<i>I</i>B<b>B</b>U<u>U</u>Z"],
  [String.raw`{\pos(1,2)\i1\b1}Hello, 世界{\i0}bold{\r}\Nnext\nline\hspace`, "<i><b>Hello, 世界</b></i><b>bold</b>\nnext\nline\\hspace"],
  [String.raw`{\u1}underlined`, "<u>underlined</u>"],
  [String.raw`{\i1}one{\i1}two{\i0}{\i0}`, "<i>onetwo</i>"]
]) {
  it(`preserves scoped ASS emphasis: ${text}`, () => {
    const doc = assAst().parse(encodeUtf8([
      "[Script Info]", "ScriptType: v4.00+", "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      `Dialogue: 3,0:00:01.00,0:00:03.00,Default,Actor,0010,0020,0030,,${text}`,
      "Dialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,plain"
    ].join("\n")));
    assert.ok(!decodeUtf8(assAst().serialize(doc)).includes("<"), "ASS output must encode emphasis as overrides");
    assert.deepEqual(assAst().parse(assAst().serialize(doc)).tracks[0]!.samples, doc.tracks[0]!.samples);
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, decodeUtf8(sample.data)]),
      [[1000, 2000, expected], [4000, 1000, "plain"]]);
  });
}
