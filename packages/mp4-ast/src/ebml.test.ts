import assert from "node:assert/strict";
import { it } from "node:test";
import { readVint, writeVintSize } from "./containers/ebml.js";

it("writes finite EBML sizes beyond four bytes without reserved markers or truncation", () => {
  for (const size of [0, 126, 127, 16383, 2097151, 268435454, 268435455, 2 ** 32, Number.MAX_SAFE_INTEGER]) {
    assert.equal(readVint(writeVintSize(size), 0, true)?.value, size);
    assert.ok(writeVintSize(size).length <= 8);
  }
});

it("recognizes unknown sizes at every VINT length using exact marker bytes", () => {
  for (let length = 1; length <= 8; length++) {
    const bytes = new Uint8Array(length).fill(255);
    bytes[0] = (1 << (9 - length)) - 1;
    assert.equal(readVint(bytes, 0, true)?.unknownSize, true);
    bytes[length - 1] = bytes[length - 1]! - 1;
    assert.equal(readVint(bytes, 0, true)?.unknownSize, false);
  }
});

import { createSyntheticMp4, parseMp4, parseMkv, serializeMkv } from "./index.js";

function element(id: number[], payload: number[]): number[] {
  return [...id, ...writeVintSize(payload.length), ...payload];
}
function unsigned(value: number): number[] {
  const bytes = [];
  do { bytes.unshift(value % 256); value = Math.floor(value / 256); } while (value);
  return bytes;
}

it("Matroska applies nanosecond DefaultDuration and BlockDuration in segment ticks", () => {
  for (const blockDuration of [undefined, 7]) {
    const entry = element([0xae], [
      ...element([0xd7], [1]), ...element([0x83], [1]),
      ...element([0x86], [...new TextEncoder().encode("V_VP8")]),
      ...element([0x23, 0xe3, 0x83], unsigned(40000000))
    ]);
    const block = [0x81, 0, 0, 0x80, 0];
    const cluster = element([0x1f, 0x43, 0xb6, 0x75], blockDuration === undefined
      ? element([0xa3], block)
      : element([0xa0], [...element([0xa1], block), ...element([0x9b], [blockDuration])]));
    const duration = new Uint8Array(8);
    new DataView(duration.buffer).setFloat64(0, 50);
    const segment = [
      ...element([0x15, 0x49, 0xa9, 0x66], [...element([0x2a, 0xd7, 0xb1], unsigned(2000000)), ...element([0x44, 0x89], [...duration])]),
      ...element([0x16, 0x54, 0xae, 0x6b], entry), ...cluster
    ];
    for (let length = 1; length <= 8; length++) {
      const unknown = new Uint8Array(length).fill(255);
      unknown[0] = (1 << (9 - length)) - 1;
      const bytes = new Uint8Array([...element([0x1a, 0x45, 0xdf, 0xa3], []), 0x18, 0x53, 0x80, 0x67, ...unknown, ...segment]);
      const doc = parseMkv(bytes);
      assert.equal(doc.tracks[0]!.timescale, 500);
      assert.equal(doc.tracks[0]!.samples[0]!.duration, blockDuration ?? 20);
      assert.equal(doc.durationSeconds, 0.1);
    }
  }
});

it("Matroska preserves 25fps video and AAC timing", () => {
  const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 25, frameCount: 50, includeAudio: true }));
  const parsed = parseMkv(serializeMkv(source));
  for (const track of parsed.tracks) {
    const original = source.tracks.find(t => t.type === track.type)!;
    assert.ok(Math.abs(track.duration / track.timescale - original.duration / original.timescale) < 0.025);
  }
  assert.ok(Math.abs(parsed.durationSeconds - source.durationSeconds) < 0.025);
});
