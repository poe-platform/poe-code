import assert from "node:assert/strict";
import { test } from "node:test";
import { flacAst, serializeFfmetadata } from "./index.js";

// STREAMINFO plus a binary CUESHEET, without Vorbis comments or audio frames.
function fixture() {
  const sheet = new Uint8Array(396 + 48 * 2 + 36);
  const view = new DataView(sheet.buffer);
  sheet[395] = 3;
  for (const [offset, id, sample] of [[396, 1, 0], [444, 2, 4000], [492, 170, 8000]]) {
    view.setBigUint64(offset!, BigInt(sample!));
    sheet[offset! + 8] = id!;
    if (id !== 170) { sheet[offset! + 35] = 1; sheet[offset! + 44] = 1; }
  }
  const bytes = new Uint8Array(46 + sheet.length);
  bytes.set([102, 76, 97, 67, 0, 0, 0, 34]);
  new DataView(bytes.buffer).setBigUint64(18, (8000n << 44n) | (15n << 36n) | 8000n);
  bytes.set([133, 0, sheet.length >>> 8, sheet.length & 255], 42);
  bytes.set(sheet, 46);
  return bytes;
}

test("binary FLAC cuesheet chapters use sample offsets and exclude lead-out across readers", async () => {
  const bytes = fixture(), plugin = flacAst();
  const expected = [
    { id: 1, time_base: "1/8000", start: 0, start_time: "0.000000", end: 4000, end_time: "0.500000", tags: { title: "" } },
    { id: 2, time_base: "1/8000", start: 4000, start_time: "0.500000", end: 8000, end_time: "1.000000", tags: { title: "" } }
  ];
  assert.deepEqual(plugin.probe(bytes).chapters, expected);
  assert.deepEqual((await plugin.probeMetadata!({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } })).chapters, expected);
  assert.deepEqual((await plugin.probeMetadataStream!((async function* () {
    for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
  })())).chapters, expected);
  const text = new TextDecoder().decode(serializeFfmetadata(plugin.parse(bytes, { decodeAudio: false })));
  assert.equal(text, ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/8000\nSTART=0\nEND=4000\ntitle=\n[CHAPTER]\nTIMEBASE=1/8000\nSTART=4000\nEND=8000\ntitle=\n");
});

test("rejects truncated binary cue sheets and indices", () => {
  const bytes = fixture();
  assert.throws(() => flacAst().probe(bytes.subarray(0, bytes.length - 1)), /Truncated FLAC CUESHEET/);
  bytes[46 + 396 + 35] = 255;
  assert.throws(() => flacAst().probe(bytes), /Truncated FLAC CUESHEET indices/);
});

test("uses track offsets, ISRC titles and a non-CD lead-out", () => {
  const bytes = fixture();
  bytes.set(new TextEncoder().encode("US1234567890"), 46 + 396 + 9);
  new DataView(bytes.buffer).setBigUint64(46 + 396 + 36, 100n);
  bytes[46 + 492 + 8] = 255;
  const chapters = flacAst().probe(bytes).chapters;
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0]!.start, 0);
  assert.deepEqual(chapters[0]!.tags, { title: "US1234567890" });
  assert.equal(chapters[1]!.end, 8000);
});
