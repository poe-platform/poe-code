import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, serializeWav } from "./index.js";
import { readWavHeader } from "./containers/wav-header.js";

const input = Buffer.from("UklGRlwAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAATElTVCYAAABJTkZPSU5BTQoAAABPbGQgdGl0bGUASUFSVAcAAABQbGF5ZXIAAGRhdGEKAAAAAIAA/wAAAAEAfw==", "base64");

for (const channels of [1, 2]) {
  for (const bits of [32, 64]) {
    it(`writes a complete float${bits} WAV header and per-channel fact count for ${channels} channels`, () => {
      const doc = parseWav(input);
      const track = doc.tracks[0]!;
      const samples = track.decodedAudio!.channelData[0]!;
      const output = Buffer.from(serializeWav({ ...doc, tracks: [{ ...track,
        codecDescriptions: [{ ...track.codecDescriptions[0]!, channels }],
        decodedAudio: { ...track.decodedAudio!, channelData: Array.from({ length: channels }, () => samples) }
      }] }, { audioCodec: `pcm_f${bits}le` }));
      const header = readWavHeader(output);
      assert.equal(header.formatTag, 3);
      assert.equal(header.formatSize, 18);
      assert.equal(output.readUInt16LE(header.formatOffset! + 16), 0);
      assert.equal(header.factSize, 4);
      assert.equal(output.readUInt32LE(header.factOffset!), 5);
      assert.equal(output.readUInt32LE(4), output.length - 8);
      const expected = Buffer.alloc(5 * channels * bits / 8);
      for (let frame = 0; frame < 5; frame++) {
        for (let channel = 0; channel < channels; channel++) {
          const offset = (frame * channels + channel) * bits / 8;
          if (bits === 32) expected.writeFloatLE(samples[frame]!, offset);
          else expected.writeDoubleLE(samples[frame]!, offset);
        }
      }
      assert.deepEqual(output.subarray(header.dataOffset, header.dataOffset + header.dataSize), expected);
    });
  }
}

it("keeps ordinary PCM16 WAV headers without a fact chunk", () => {
  const output = Buffer.from(serializeWav(parseWav(input), { audioCodec: "pcm_s16le" }));
  const header = readWavHeader(output);
  assert.equal(header.formatTag, 1);
  assert.equal(header.formatSize, 16);
  assert.equal(header.factOffset, undefined);
  assert.deepEqual(output.subarray(header.dataOffset, header.dataOffset + header.dataSize), input.subarray(readWavHeader(input).dataOffset));
});
