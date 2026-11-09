import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMp4, serializeMpegTs } from "./index.js";

const input = parseMp4(readFileSync(new URL("./fixtures/mpegts-interleave.mp4", import.meta.url)));

function inspect(bytes: Uint8Array) {
  const sequence: number[] = [];
  const streams = new Map<number, Buffer[]>();
  const continuity = new Map<number, number>();
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = Buffer.from(bytes.subarray(offset, offset + 188));
    assert.equal(packet[0], 0x47);
    const pid = packet.readUInt16BE(1) & 8191;
    const adaptation = (packet[3]! >> 4) & 3;
    if (!(adaptation & 1)) continue;
    const previous = continuity.get(pid);
    if (previous !== undefined) assert.equal(packet[3]! & 15, (previous + 1) & 15);
    continuity.set(pid, packet[3]! & 15);
    let start = 4 + (adaptation & 2 ? 1 + packet[4]! : 0);
    if (packet[1]! & 64) {
      if (packet.readUIntBE(start, 3) !== 1) continue;
      sequence.push(packet[start + 3]!);
      if (!streams.has(pid)) streams.set(pid, []);
      start += 9 + packet[start + 8]!;
    }
    streams.get(pid)?.push(packet.subarray(start));
  }
  return { sequence, payloads: [...streams.values()].map(parts => Buffer.concat(parts)) };
}

for (const reverse of [false, true]) {
  it(`interleaves copied video and audio throughout MPEG-TS, reverse=${reverse}`, () => {
    const tracks = reverse ? [...input.tracks].reverse() : input.tracks;
    const { sequence, payloads } = inspect(serializeMpegTs({ ...input, tracks }));
    const videoPositions = sequence.flatMap((pid, i) => pid === 0xe0 ? [i] : []);
    assert.equal(videoPositions.length, 30);
    for (let i = 0; i < 30; i += 10) {
      assert.ok(sequence.slice(videoPositions[i]!, videoPositions[i + 9]).includes(0xc0),
        `audio must be delivered during video frames ${i} through ${i + 9}`);
    }
    for (const track of tracks) {
      const single = inspect(serializeMpegTs({ ...input, tracks: [track] })).payloads[0]!;
      assert.ok(payloads.some(payload => payload.equals(single)), "elementary stream bytes stay intact");
    }
  });
}
