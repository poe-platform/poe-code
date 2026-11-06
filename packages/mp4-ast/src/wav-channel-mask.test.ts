import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, serializeWav } from "./index.js";
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

for (const mask of [0, 0x3f, 0x60f, 0x707]) {
  for (const audioCodec of ["pcm_s16le", "pcm_f32le", "copy"]) {
    it(`preserves explicit WAV mask ${mask} when writing ${audioCodec}`, () => {
      const input = Buffer.from(header, "hex");
      input.writeUInt32LE(mask, 40);
      // Include one PCM frame so the packet-copy path has a packet.
      input.writeUInt32LE(12, 64);
      const doc = parseWav(Buffer.concat([input, Buffer.alloc(12)]));
      const bytes = Buffer.from(serializeWav(doc, { audioCodec }));
      assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
      assert.equal(bytes.readUInt32LE(16), 40);
      assert.equal(bytes.readUInt16LE(20), 0xfffe);
      assert.equal(bytes.readUInt16LE(36), 22);
      assert.equal(bytes.readUInt16LE(38), audioCodec === "pcm_f32le" ? 32 : 16);
      assert.equal(bytes.readUInt32LE(40), mask);
      assert.equal(bytes.subarray(44, 60).toString("hex"),
        `${audioCodec === "pcm_f32le" ? "03" : "01"}00000000001000800000aa00389b71`);
      assert.equal(parseWav(bytes).tracks[0]!.decodedAudio!.channelMask, mask);
    });
  }
}
