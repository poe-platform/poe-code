import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { wavpackAst } from "@poe-code/mp4-ast";

it("decodes WavPack streams whose muxer could not patch the total sample count", () => {
  const original = readFileSync(new URL("./fixtures/wavpack-int32-stereo-blocks.wv", import.meta.url));
  const streamed = Buffer.from(original);
  // Native FFmpeg writes zero total_samples when its WavPack output is a pipe.
  for (let at = 0; streamed.toString("ascii", at, at + 4) === "wvpk"; at += streamed.readUInt32LE(at + 4) + 8) {
    streamed.writeUInt32LE(0, at + 12);
  }
  const plugin = wavpackAst();
  const expected = plugin.parse(original);
  const decoded = plugin.parse(streamed);
  assert.equal(decoded.duration, 529);
  assert.deepEqual(decoded.tracks[0]!.decodedAudio, expected.tracks[0]!.decodedAudio);
  assert.equal(plugin.parse(streamed, { decodeAudio: false }).duration, 529);
  assert.deepEqual(Buffer.from(plugin.serialize(decoded, { audioCodec: "copy" })), Buffer.concat(decoded.tracks[0]!.samples.map(p => p.data)));
});
