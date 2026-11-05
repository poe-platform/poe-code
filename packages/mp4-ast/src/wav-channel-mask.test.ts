import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav } from "./index.js";
import { readWavHeader, readWavSourceHeader, readWavStreamHeader } from "./containers/wav-header.js";

const header = "52494646ffffffff57415645666d742028000000feff0600401f0000007701000c001000160010003f0000000100000000001000800000aa00389b716461746100000000";

it("retains extensible WAV speaker masks in byte, range, stream and decoded PCM reads", async () => {
  for (const mask of [0, 0x3f, 0x60f, 0x707]) {
    const bytes = Buffer.from(header, "hex");
    bytes.writeUInt32LE(mask, 40);
    assert.equal(readWavHeader(bytes).channelMask, mask);
    const source = await readWavSourceHeader({ size: bytes.length, async read(offset, length) {
      assert.ok(length <= 16);
      return bytes.subarray(offset, offset + Math.min(length, 3));
    } });
    assert.equal(source.channelMask, mask);
    const streamed = await readWavStreamHeader((async function* () {
      for (const byte of bytes) yield Uint8Array.of(byte);
    })());
    assert.equal(streamed.channelMask, mask);
    assert.equal(parseWav(bytes).tracks[0]!.decodedAudio!.channelMask, mask);
  }
});

it("rejects incomplete extensible WAV format declarations", () => {
  for (const [offset, value] of [[16, 16], [36, 0]] as const) {
    const bytes = Buffer.from(header, "hex");
    bytes.writeUInt16LE(value, offset);
    assert.throws(() => readWavHeader(bytes), /Invalid WAV extensible format/);
  }
});
