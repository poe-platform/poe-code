import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { encodeWav } from "@poe-code/audio-ast";
import { flacAst, wavAst } from "./index.js";

for (const bits of [16, 24]) for (const compressionLevel of [undefined, 0, 8, 12]) {
  it(`preserves stereo extrema, odd sums and MD5 in ${bits}-bit FLAC at level ${compressionLevel}`, () => {
    const scale = 2 ** (bits - 1);
    const integers = [-scale, scale - 1, -1, 0, 1, 2, -3];
    const channels = [0, 1].map(channel => Float64Array.from({ length: 4113 }, (_, i) =>
      (i < 2048 ? i + channel : integers[(i + channel) % integers.length]!) / scale));
    const pcm = Buffer.alloc(channels[0]!.length * 2 * bits / 8);
    for (let i = 0; i < channels[0]!.length; i++) for (let c = 0; c < 2; c++) {
      pcm.writeIntLE(channels[c]![i]! * scale, (i * 2 + c) * bits / 8, bits / 8);
    }
    const doc = wavAst().parse(encodeWav({ channels, sampleRate: 16000 }, { bitsPerSample: bits as 16 | 24 }));
    for (const channelMode of ["indep", "left_side", "right_side", "mid_side"]) {
      const output = flacAst().serialize(doc, { channelMode, compressionLevel });
      assert.deepEqual(Buffer.from(output.subarray(26, 42)), createHash("md5").update(pcm).digest());
      const decoded = flacAst().parse(output).tracks[0]!.decodedAudio!;
      assert.deepEqual(decoded.channelData, channels);
    }
  });
}

it("keeps mono and multichannel FLAC independent when a stereo mode is requested", () => {
  for (const count of [1, 3, 8]) {
    const channels = Array.from({ length: count }, (_, c) => Float64Array.from({ length: 31 }, (_, i) => (i - c) / 32768));
    const doc = wavAst().parse(encodeWav({ channels, sampleRate: 16000 }, { bitsPerSample: 16 }));
    const decoded = flacAst().parse(flacAst().serialize(doc, { channelMode: "mid_side" }));
    assert.equal(decoded.tracks[0]!.samples[0]!.data[3]! >>> 4, count - 1);
    assert.deepEqual(decoded.tracks[0]!.decodedAudio!.channelData, channels);
  }
});
