import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4 } from "./mp4.js";
import { serializeMpegTs } from "./containers/mpegts.js";
import { MediaLimitExceededError } from "./types.js";

const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 25, frameCount: 20, includeAudio: true }), { decodeAudio: false });
const audio = { ...source, tracks: source.tracks.filter(track => track.type === "audio") };

function inspect(bytes: Uint8Array) {
  const clocks: { packet: number; ticks: number }[] = [];
  const payloads = new Map<number, number[]>();
  const continuity = new Map<number, number>();
  let nulls = 0;
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const p = bytes.subarray(offset, offset + 188);
    assert.equal(p.length, 188);
    assert.equal(p[0], 0x47);
    const pid = ((p[1]! & 31) << 8) | p[2]!;
    const adaptation = p[3]! >> 4 & 3;
    if (pid === 8191) { nulls++; continue; }
    if ((adaptation & 2) && p[4]! >= 7 && (p[5]! & 16)) {
      const base = p[6]! * 2 ** 25 + p[7]! * 2 ** 17 + p[8]! * 512 + p[9]! * 2 + (p[10]! >> 7);
      clocks.push({ packet: offset / 188, ticks: base * 300 + ((p[10]! & 1) << 8) + p[11]! });
    }
    const cc = p[3]! & 15;
    if (continuity.has(pid)) assert.equal(cc, (continuity.get(pid)! + (adaptation & 1)) & 15);
    continuity.set(pid, cc);
    if (!(adaptation & 1) || pid < 256 || pid >= 4096) continue;
    let pos = 4 + ((adaptation & 2) ? 1 + p[4]! : 0);
    if (p[1]! & 64) {
      assert.deepEqual([...p.subarray(pos, pos + 3)], [0, 0, 1]);
      pos += 9 + p[pos + 8]!;
    }
    const payload = payloads.get(pid) ?? [];
    payload.push(...p.subarray(pos));
    payloads.set(pid, payload);
  }
  return { clocks, payloads, nulls };
}

for (const doc of [audio, source, { ...source, tracks: [...source.tracks, { ...audio.tracks[0]!, id: 3 }] }]) {
  for (const muxRate of [500000, 1000000, 750001]) {
    it(`pads ${doc.tracks.length} streams at ${muxRate} bits/s without changing elementary bytes`, () => {
      const plain = inspect(serializeMpegTs(doc));
      const bytes = serializeMpegTs(doc, { muxRate });
      const actual = inspect(bytes);
      assert.equal(plain.nulls, 0);
      assert.ok(actual.nulls > 0);
      assert.deepEqual(actual.payloads, plain.payloads);
      assert.ok(actual.clocks.length > 2);
      const first = actual.clocks[0]!;
      for (const clock of actual.clocks.slice(1)) {
        const elapsed = (clock.ticks - first.ticks + 2 ** 33 * 300) % (2 ** 33 * 300);
        assert.ok(Math.abs(elapsed - (clock.packet - first.packet) * 188 * 8 * 27000000 / muxRate) < 1.01);
      }
      for (let i = 1; i < actual.clocks.length; i++) {
        assert.ok((actual.clocks[i]!.packet - actual.clocks[i - 1]!.packet) * 1504 / muxRate <= 0.02 + 1504 / muxRate);
      }
      const lastDts = Math.max(...doc.tracks.flatMap(t => t.samples.map(s => s.dts / t.timescale)));
      assert.ok(bytes.length * 8 / muxRate >= lastDts);
      assert.ok(bytes.length * 8 / muxRate < lastDts + 0.1);
    });
  }
}

it("keeps zero and one muxrate in variable-rate mode", () => {
  const plain = serializeMpegTs(audio);
  for (const muxRate of [0, 1]) assert.deepEqual(serializeMpegTs(audio, { muxRate }), plain);
});

it("rejects invalid SDK rates and bounds padding before allocation", () => {
  for (const muxRate of [-1, 1.5, NaN, Infinity, 2147483648]) {
    assert.throws(() => serializeMpegTs(audio, { muxRate }), /muxrate/i);
  }
  for (const limits of [{ maxOutputBytes: 1000 }, { maxMemoryBytes: 1000 }]) {
    assert.throws(() => serializeMpegTs(audio, { muxRate: 2147483647, limits }), MediaLimitExceededError);
  }
});
