import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, probeMkv, serializeMkv } from "./containers/mkv.js";
import { serializeSubtitleDocument } from "./containers/adapters.js";

// Independent FFmpeg 7.0.2 fixtures: ffmpeg -kind KIND -i cues.vtt -c copy out.webm.
const expected = "WEBVTT\n\nspeaker-a\n00:00.125 --> 00:00.625 align:start position:20%\nFirst line.\n\n00:00.750 --> 00:01.000\nSecond line.\n";
for (const kind of ["subtitles", "captions", "descriptions", "metadata"]) {
  const input = readFileSync(new URL(`./fixtures/webvtt-${kind}.webm`, import.meta.url));
  it(`recognizes native WebVTT ${kind} and retains cue payloads and timing`, () => {
    const doc = parseMkv(input);
    const track = doc.tracks[0]!;
    assert.equal(track.type, "subtitle");
    assert.equal(track.codecDescriptions[0]!.codecName, "webvtt");
    assert.equal(Buffer.from(serializeSubtitleDocument(doc, "webvtt")).toString(), expected);
    const stream = probeMkv(input).streams[0]!;
    assert.equal(stream.codec_type, "subtitle");
    assert.equal(stream.codec_name, "webvtt");
    for (const disposition of ["captions", "descriptions", "metadata"]) {
      assert.equal(stream.disposition[disposition], Number(kind === disposition));
    }
  });

  for (const webm of [false, true]) {
    it(`retains WebVTT ${kind} when remuxing to ${webm ? "WebM" : "Matroska"}`, () => {
      const bytes = serializeMkv(parseMkv(input), { webm });
      assert.ok(Buffer.from(bytes).includes(Buffer.from(`D_WEBVTT/${kind.toUpperCase()}`)));
      const doc = parseMkv(bytes);
      assert.equal(Buffer.from(serializeSubtitleDocument(doc, "webvtt")).toString(), expected);
      assert.deepEqual(probeMkv(bytes).streams[0]!.disposition, probeMkv(input).streams[0]!.disposition);
    });
  }
}
