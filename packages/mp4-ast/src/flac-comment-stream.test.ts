import assert from "node:assert/strict";
import { it } from "node:test";
import { parseAudio, flacFormatTags } from "@poe-code/audio-ast";
import { FlacFrameScanner } from "./containers/flac-probe.js";

function fixture(comments: string[], vendor = "") {
  const vendorBytes = new TextEncoder().encode(vendor);
  const fields = comments.map(value => new TextEncoder().encode(value));
  const length = 8 + vendorBytes.length + fields.reduce((sum, field) => sum + 4 + field.length, 0);
  const bytes = new Uint8Array(46 + length), view = new DataView(bytes.buffer);
  bytes.set([102, 76, 97, 67, 0, 0, 0, 34]);
  view.setBigUint64(18, (48000n << 44n) | (1n << 41n) | (15n << 36n) | 96000n);
  bytes.set([132, length >>> 16, length >>> 8 & 255, length & 255], 42);
  view.setUint32(46, vendorBytes.length, true);
  bytes.set(vendorBytes, 50);
  view.setUint32(50 + vendorBytes.length, fields.length, true);
  let offset = 54 + vendorBytes.length;
  for (const field of fields) { view.setUint32(offset, field.length, true); bytes.set(field, offset + 4); offset += 4 + field.length; }
  return bytes;
}

it("streams large UTF-8 comments without block-sized allocations or key folding", () => {
  const key = "ß😀".repeat(15000), value = "é😀".repeat(50000);
  const bytes = fixture([`${key}=${value}`, "Artist=Alice", "artist=Bob", "CHAPTER001=00:00:00.125", "CHAPTER001NAME=Intro", "replaygain_track_gain=-3 dB"]);
  const Native = globalThis.Uint8Array, upper = String.prototype.toUpperCase;
  const scanner = new FlacFrameScanner();
  try {
    globalThis.Uint8Array = new Proxy(Native, { construct(target, args) {
      const result = Reflect.construct(target, args) as Uint8Array;
      assert.ok(result.length <= 65536, `allocation: ${result.length}`); return result;
    } });
    String.prototype.toUpperCase = function () { assert.ok(this.length <= 32768); return upper.call(this); };
    for (let offset = 0; offset < bytes.length; offset += 16381) scanner.push(bytes.subarray(offset, offset + 16381));
    scanner.push(new Uint8Array(), true);
  } finally { globalThis.Uint8Array = Native; String.prototype.toUpperCase = upper; }
  assert.equal(scanner.tags[key], value);
  assert.equal(scanner.tags.artist, "Alice;Bob");
  assert.equal(scanner.hasReplayGain, true);
  assert.deepEqual(scanner.chapters(48000), [{ id: 1, timescale: 1000, startTimeSeconds: 0.125, endTimeSeconds: 2, title: "Intro", tags: { title: "Intro" } }]);
});

it("does not publish comments from a malformed block", () => {
  const bytes = fixture(["TITLE=Discarded", "ARTIST=Truncated"]);
  new DataView(bytes.buffer).setUint32(54 + 4 + "TITLE=Discarded".length, 1000, true);
  const scanner = new FlacFrameScanner();
  for (const byte of bytes) scanner.push(Uint8Array.of(byte));
  scanner.push(new Uint8Array(), true);
  assert.deepEqual(scanner.tags, {});
});

for (const chunkSize of [1, 7, 4095, 16384]) it(`matches resident comments across ${chunkSize}-byte chunks and multiple blocks`, () => {
  const first = fixture(["", "missing separator", "=no key", "Artist=Alice", "artist=Bob", "AlbumArtist=Group", "DESCRIPTION=", "description=Text", "\uFEFFROLE=é😀", "ROLE=Voice", "TITLE="], "vendor😀");
  const second = fixture(["artist=Chloé", "TRACKNUMBER=2", "CHAPTER001=00:00:00.500", "CHAPTER001NAME=é😀"], "another vendor").subarray(42);
  const expected = { ...flacFormatTags(parseAudio(first).nodes),
    ...flacFormatTags(parseAudio(fixture(["artist=Chloé", "TRACKNUMBER=2", "CHAPTER001=00:00:00.500", "CHAPTER001NAME=é😀"])).nodes) };
  first[42] = 4;
  const bytes = new Uint8Array(first.length + second.length);
  bytes.set(first); bytes.set(second, first.length);
  const scanner = new FlacFrameScanner();
  for (let offset = 0; offset < bytes.length; offset += chunkSize) scanner.push(bytes.subarray(offset, offset + chunkSize));
  scanner.push(new Uint8Array(), true);
  assert.deepEqual(scanner.tags, expected);
  assert.equal(scanner.chapters(48000)[0]?.title, "é😀");
});
