import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { crc32 } from "node:zlib";
import { readVint } from "./containers/ebml.js";
import { parseMkv, serializeMkv } from "./containers/mkv.js";

const source = parseMkv(new Uint8Array(readFileSync(new URL("./fixtures/vp9-alpha.webm", import.meta.url))));

function elements(bytes: Uint8Array, start = 0, end = bytes.length) {
  const result: { id: number; start: number; data: number; end: number }[] = [];
  while (start < end) {
    const id = readVint(bytes, start, false)!;
    const size = readVint(bytes, start + id.length, true)!;
    const data = start + id.length + size.length;
    const next = data + size.value;
    assert.ok(next <= end);
    result.push({ id: id.value, start, data, end: next });
    start = next;
  }
  return result;
}

for (const format of ["matroska", "webm"]) {
  for (const writeCrc32 of [undefined, true, false]) {
    it(`writes valid level-one checksums for ${format}, writeCrc32=${writeCrc32}`, () => {
      const doc = { ...source, metadata: { artist: "CRC fixture" },
        tracks: source.tracks.map(track => ({ ...track, samples: track.samples.map((sample, index) => ({
          ...sample, pts: index * 40000, dts: index * 40000
        })) })),
        attachments: [{ tags: { filename: "note.txt", mimetype: "text/plain" }, data: new Uint8Array([42]), size: 1 }],
        chapters: [{ id: 1, startTimeSeconds: 0, endTimeSeconds: 1, title: "Start" }] };
      const bytes = serializeMkv(doc, { format, writeCrc32 });
      const top = elements(bytes);
      const header = top.find(element => element.id === 0x1a45dfa3)!;
      const docType = elements(bytes, header.data, header.end).find(element => element.id === 0x4282)!;
      assert.equal(new TextDecoder().decode(bytes.subarray(docType.data, docType.end)), format);
      const segment = top.find(element => element.id === 0x18538067)!;
      const parents = elements(bytes, segment.data, segment.end);
      for (const id of [0x114d9b74, 0x1c53bb6b, 0x1549a966, 0x1654ae6b, 0x1254c367, 0x1f43b675, 0x1941a469, 0x1043a770]) {
        assert.ok(parents.some(parent => parent.id === id), `missing parent ${id.toString(16)}`);
      }
      assert.ok(parents.filter(parent => parent.id === 0x1f43b675).length > 1);
      for (const parent of parents) {
        const checksums = elements(bytes, parent.data, parent.end).filter(child => child.id === 0xbf);
        assert.equal(checksums.length, format === "matroska" && writeCrc32 !== false ? 1 : 0,
          `CRC count in ${parent.id.toString(16)}`);
        for (const checksum of checksums) {
          assert.equal(checksum.start, parent.data);
          assert.equal(checksum.end - checksum.data, 4);
          const stored = new DataView(bytes.buffer, bytes.byteOffset + checksum.data, 4).getUint32(0, true);
          assert.equal(stored, crc32(bytes.subarray(checksum.end, parent.end)), `CRC in ${parent.id.toString(16)}`);
        }
      }
      const packets = (document: typeof source) => document.tracks.map(track => track.samples.map(sample => ({
        pts: sample.pts, data: sample.data, isKeyframe: sample.isKeyframe, blockAdditions: sample.blockAdditions
      })));
      assert.deepEqual(packets(parseMkv(bytes)), packets(doc));
    });
  }
}
