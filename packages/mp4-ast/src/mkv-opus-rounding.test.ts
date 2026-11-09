import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMkv, serializeMkv } from "./containers/mkv.js";
import { oggAst } from "./index.js";

const input = new Uint8Array(readFileSync(new URL("../../safe-bash-command-ffmpeg/src/fixtures/tone-opus.ogg", import.meta.url)));

for (const webm of [false, true]) {
  it(`rounds negative Opus half-millisecond timestamps away from zero in ${webm ? "WebM" : "Matroska"}`, () => {
    const source = oggAst().parse(input, { decodeAudio: false });
    const track = source.tracks[0]!;
    assert.equal(track.timescale, 48000);
    assert.equal(track.samples[0]!.pts, -312);
    const copied = parseMkv(serializeMkv(source, { webm }));
    const samples = copied.tracks[0]!.samples;
    // Native FFmpeg rounds -6.5 ms to -7, but +13.5 ms to +14.
    assert.deepEqual(samples.slice(0, 5).map(sample => sample.pts), [-7, 14, 34, 54, 74]);
    assert.deepEqual(samples.map(sample => sample.data), track.samples.map(sample => sample.data));
    assert.equal(copied.tracks[0]!.codecDelayNs, track.codecDelayNs);
    assert.deepEqual(parseMkv(serializeMkv(copied, { webm })).tracks[0]!.samples.map(sample => sample.pts),
      samples.map(sample => sample.pts));
  });
}
