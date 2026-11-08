import assert from "node:assert/strict";
import { it } from "node:test";
import { rawAudioAsts } from "./containers/raw-audio.js";

for (const format of ["s16le", "s24be", "f64le"]) for (const channels of [1, 2]) {
  it(`preserves incomplete ${format} packets with ${channels} channels without decoding`, () => {
    const plugin = rawAudioAsts().find(plugin => plugin.id === format)!;
    const width = Number.parseInt(format.slice(1), 10) / 8;
    for (const size of [1, 512 * width * channels + 1]) {
      const input = new Uint8Array(size).fill(0x5a);
      const doc = plugin.parse(input, { sampleRate: 8000, channels, decodeAudio: false });
      assert.equal(doc.duration, Math.floor(size / (width * channels)));
      assert.equal(doc.tracks[0]!.decodedAudio, undefined);
      assert.deepEqual(plugin.serialize(doc, { audioCodec: "copy" }), input);
      assert.ok(doc.tracks[0]!.samples.every(sample => Number.isInteger(sample.duration)));
      if (size < width * channels) {
        assert.throws(() => plugin.parse(input, { sampleRate: 8000, channels }), /Incomplete raw audio sample frame/);
      }
    }
  });
}
