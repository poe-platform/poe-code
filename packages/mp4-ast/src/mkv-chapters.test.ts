import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { probeMkv } from "./containers/mkv.js";
import { readVint, writeVintSize } from "./containers/ebml.js";

const fixture = readFileSync(new URL("./fixtures/chapters.mka", import.meta.url));
function element(id: number[], payload: number[]): number[] {
  return [...id, ...writeVintSize(payload.length), ...payload];
}
function unsigned(value: number): number[] {
  const bytes: number[] = [];
  do { bytes.unshift(value % 256); value = Math.floor(value / 256); } while (value);
  return bytes;
}
function chapter(id: number, start: number, end: number, title: string, children: number[] = []): number[] {
  return element([0xb6], [
    ...element([0x73, 0xc4], unsigned(id)),
    ...element([0x91], unsigned(start)), ...element([0x92], unsigned(end)),
    ...element([0x80], element([0x85], [...new TextEncoder().encode(title)])), ...children
  ]);
}
function edition(chapters: number[], isDefault = false): number[] {
  return element([0x45, 0xb9], [...element([0x45, 0xdb], [Number(isDefault)]), ...chapters]);
}
function withEditions(editions: number[]): Uint8Array {
  const headerSize = readVint(fixture, 4, true)!;
  const headerEnd = 4 + headerSize.length + headerSize.value;
  const segmentSize = readVint(fixture, headerEnd + 4, true)!;
  const parts: number[] = [];
  let pos = headerEnd + 4 + segmentSize.length;
  while (pos < fixture.length) {
    const id = readVint(fixture, pos, false)!;
    const size = readVint(fixture, pos + id.length, true)!;
    const end = pos + id.length + size.length + size.value;
    if (id.value !== 0x1043a770 && id.value !== 0x114d9b74) parts.push(...fixture.subarray(pos, end));
    pos = end;
  }
  return new Uint8Array([...fixture.subarray(0, headerEnd), ...element([0x18, 0x53, 0x80, 0x67], [
    ...element([0x10, 0x43, 0xa7, 0x70], editions), ...parts
  ])]);
}

it("leaves chapterless Matroska empty", () => {
  assert.deepEqual(probeMkv(withEditions([])).chapters, []);
});
it("reports top-level chapters from all editions regardless of the default flag", () => {
  for (const isDefault of [false, true]) {
    const chapters = probeMkv(withEditions([
      ...edition(chapter(7, 0, 250000000, "First")),
      ...edition(chapter(9, 250000001, 1000000001, "Default é"), isDefault)
    ])).chapters;
    assert.deepEqual(chapters, [{
      id: 7, time_base: "1/1000000000", start: 0, start_time: "0.000000",
      end: 250000000, end_time: "0.250000", tags: { title: "First" }
    }, {
      id: 9, time_base: "1/1000000000", start: 250000001, start_time: "0.250000",
      end: 1000000001, end_time: "1.000000", tags: { title: "Default é" }
    }]);
  }
});
it("omits nested chapters like native ffprobe", () => {
  const chapters = probeMkv(withEditions(edition(chapter(7, 0, 1000000000, "Parent",
    chapter(8, 250000000, 500000000, "Child"))))).chapters;
  assert.deepEqual(chapters.map(chapter => [chapter.id, chapter.tags.title]), [[7, "Parent"]]);
});
