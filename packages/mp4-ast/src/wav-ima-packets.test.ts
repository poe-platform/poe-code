import assert from "node:assert/strict";
import { it } from "node:test";
import { wavAst, probeWavSource, probeWavStream } from "./containers/adapters.js";

// Native FFmpeg IMA WAV header; packet inspection does not decode the payload.
const header = "52494646560c000057415645666d74201400000011000100401f0000ad0f0000000404000200f9076661637404000000001000004c4953541a000000494e464f495346540d0000004c61766636332e312e313031000064617461000c0000";
for (const size of [1, 1025, 4097]) {
  it(`retains all ${size} IMA WAV bytes across buffered, ranged and streaming packet probes`, async () => {
    const bytes = Buffer.concat([Buffer.from(header, "hex"), Buffer.alloc(size)]);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.writeUInt32LE(size, 90);
    const options = { showPackets: true };
    const probes = [
      await wavAst().probe!(bytes, options),
      await probeWavSource({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } }, options),
      await probeWavStream((async function* () { yield bytes.subarray(0, 95); yield bytes.subarray(95); })(), options)
    ];
    for (const probe of probes) {
      assert.equal(probe.streams[0]!.duration_ts, size * 2);
      assert.deepEqual(Array.from(probe.packets!, packet => ({ pos: packet.pos, size: packet.size, duration: packet.duration })),
        size === 4097 ? [{ pos: "94", size: "4096", duration: 8164 }, { pos: "4190", size: "1", duration: undefined }]
          : [{ pos: "94", size: String(size), duration: size === 1025 ? 2041 : undefined }]);
    }
  });
}
