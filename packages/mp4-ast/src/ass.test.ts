import assert from "node:assert/strict";
import { it } from "node:test";
import { assAst } from "./containers/ass.js";
import { decodeUtf8, encodeUtf8 } from "./binary.js";

it("reads native ASS event fields, commas, Unicode, overrides and line breaks", () => {
  const plugin = assAst();
  const bytes = encodeUtf8([
    "\uFEFF[Script Info]", "ScriptType: v4.00+", "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Comment: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,ignored",
    "Dialogue: 0,1:02:03.45,1:02:04.67,Default,,0,0,0,,{\\pos(2,3)}Hello, 世界\\Nnext\\nline\\hspace",
    "Dialogue: 0,0:00:01.25,0:00:03.50,Default,,0,0,0,,first"
  ].join("\r\n"));
  assert.equal(plugin.detect(bytes), true);
  const doc = plugin.parse(bytes);
  const samples = doc.tracks[0]!.samples;
  assert.deepEqual(samples.map(sample => [sample.pts, sample.duration, decodeUtf8(sample.data)]), [
    [1250, 2250, "first"], [3723450, 1220, "Hello, 世界\nnext\nline\\hspace"]
  ]);
  const restored = plugin.parse(plugin.serialize(doc));
  assert.deepEqual(restored.tracks[0]!.samples, samples);
  assert.equal(plugin.probe(bytes).streams[0]!.codec_name, "ass");
});

it("honors declared event field order and ignores invalid cue times", () => {
  const doc = assAst().parse(encodeUtf8([
    "[Script Info]", "[Events]", "Format: Start, End, Layer, Text",
    "Dialogue: 0:00:01.25,0:00:03.50,0,a,b",
    "Dialogue: invalid,0:00:03.50,0,ignored",
    "Dialogue: 0:00:05.00,0:00:03.50,0,reversed"
  ].join("\n")));
  assert.equal(doc.tracks[0]!.samples.length, 2);
  assert.equal(decodeUtf8(doc.tracks[0]!.samples[0]!.data), "a,b");
});

it("copies encoded ASS event fields in declared order while retaining editable timestamps", () => {
  const plugin = assAst();
  const header = "[Script Info]\nPlayResX: 640\n[Events]\nFormat: Start, End, Layer, Text\n";
  const doc = plugin.parse(encodeUtf8(header + "Dialogue: 0:00:01.25,0:00:03.50,3,{\\i1}a,b\\Nnext{\\i0}\n"),
    { decodeSubtitles: false });
  const track = doc.tracks[0]!;
  assert.equal(decodeUtf8(track.samples[0]!.data), "0,3,,,,,,,{\\i1}a,b\\Nnext{\\i0}");
  const shifted = { ...doc, tracks: [{ ...track, samples: track.samples.map(sample => ({ ...sample, pts: sample.pts + 1000 })) }] };
  assert.equal(decodeUtf8(plugin.serialize(shifted)), header + "Dialogue: 0:00:02.25,0:00:04.50,3,{\\i1}a,b\\Nnext{\\i0}\n");
});

for (const decodeSubtitles of [false, true]) {
  it(`retains reversed ASS intervals, decodeSubtitles=${decodeSubtitles}`, () => {
    const plugin = assAst();
    const input = encodeUtf8("[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 3,0:00:03.00,0:00:01.00,Default,Actor,0010,0020,0030,,Timed\n");
    const doc = plugin.parse(input, { decodeSubtitles });
    assert.equal(doc.tracks[0]!.samples.length, 1);
    const sample = doc.tracks[0]!.samples[0]!;
    assert.equal(sample.pts, 3000);
    assert.equal(sample.duration, decodeSubtitles ? 4294965296 : -2000);
    if (decodeSubtitles) {
      assert.equal(doc.duration, 4294968296);
    } else {
      assert.ok(decodeUtf8(plugin.serialize(doc)).includes("0:00:03.00,0:00:01.00"));
    }
  });
}
