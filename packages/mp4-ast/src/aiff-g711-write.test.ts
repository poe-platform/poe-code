import assert from "node:assert/strict";
import { it } from "node:test";
import { aiffAst, parseAiff, serializeAiff } from "./containers/aiff.js";
import { rawAudioAsts } from "./containers/raw-audio.js";

for (const codec of ["pcm_alaw", "pcm_mulaw"]) {
  for (const channels of [1, 2]) {
    it(`writes ${codec} with ${channels} channels and three frames`, () => {
      const input = rawAudioAsts().find(plugin => plugin.id === "s16be")!.parse(
        new Uint8Array(3 * channels * 2), { channels, sampleRate: 8000 });
      const bytes = Buffer.from(serializeAiff(input, { audioCodec: codec }));
      assert.equal(bytes.toString("ascii", 8, 12), "AIFC");
      assert.equal(bytes.readUInt32BE(34), 3);
      assert.equal(bytes.readUInt16BE(32), channels);
      assert.equal(bytes.readUInt16BE(38), 8);
      assert.equal(bytes.readUInt32BE(60), 8 + 3 * channels);
      assert.equal(bytes.length, 72 + 3 * channels + (3 * channels) % 2);
      if (channels === 1) assert.equal(bytes.at(-1), 0);
      const probe = aiffAst().probe(bytes);
      assert.equal(probe.streams[0]!.codec_name, codec);
      assert.equal(probe.streams[0]!.channels, channels);
      assert.equal(probe.streams[0]!.sample_rate, "8000");
      assert.deepEqual(Buffer.from(serializeAiff(parseAiff(bytes, { decodeAudio: false }), { audioCodec: "copy" })), bytes);
      assert.equal(parseAiff(bytes).tracks[0]!.decodedAudio!.channelData[0]!.length, 3);
    });
  }
}
