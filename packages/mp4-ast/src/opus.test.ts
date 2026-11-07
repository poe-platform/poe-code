import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { oggAst, parseWav } from "./index.js";

for (const count of [1, 64, 960, 4800]) {
  it(`decodes ${count}-sample stereo Opus with exact trimming and separate channels`, () => {
    const source = parseWav(encodeWav({ sampleRate: 48000, channels: [
      Float64Array.from({ length: count }, (_, i) => Math.sin(i * 0.1) * 0.4), new Float64Array(count)
    ] }));
    const bytes = oggAst().serialize(source, { format: "opus" });
    const track = oggAst().parse(bytes).tracks[0]!;
    assert.equal(track.decodedAudio!.sampleRate, 48000);
    assert.equal(track.decodedAudio!.channels, 2);
    assert.deepEqual(track.decodedAudio!.channelData.map(channel => channel.length), [count, count]);
    assert.ok(track.decodedAudio!.channelData[1]!.every(sample => Math.abs(sample) < 0.001));
    if (count > 64) assert.ok(track.decodedAudio!.channelData[0]!.some(sample => Math.abs(sample) > 0.3));
    const encoded = oggAst().parse(bytes, { decodeAudio: false }).tracks[0]!;
    assert.equal(encoded.decodedAudio, undefined);
    assert.deepEqual(encoded.samples, track.samples);
  });
}

it("decodes multiplexed Opus streams independently", () => {
  const bytes = readFileSync(new URL("../../safe-bash-command-ffmpeg/src/fixtures/two-opus.ogg", import.meta.url));
  const tracks = oggAst().parse(bytes).tracks;
  assert.equal(tracks.length, 2);
  for (const track of tracks) assert.equal(track.decodedAudio!.channelData[0]!.length, 36000);
  assert.notDeepEqual(tracks[0]!.decodedAudio!.channelData[0], tracks[1]!.decodedAudio!.channelData[0]);
});
