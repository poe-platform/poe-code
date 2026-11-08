import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMp4, parseSubtitleDocument, serializeMp4, serializeSubtitleDocument } from "./index.js";

// Native FFmpeg: -i timed-text.srt -c:s mov_text timed-text-styles.mp4
it("decodes native mov_text style spans without styling adjacent text", () => {
  const bytes = readFileSync(new URL("./fixtures/timed-text-styles.mp4", import.meta.url));
  const doc = parseMp4(bytes);
  assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "srt")),
    "1\n00:00:00,250 --> 00:00:01,125\nPlain <i>slant</i> <b>bold</b>\nNext line\n\n");
});

it("handles Unicode character offsets, combined styles and malformed style boxes", async () => {
  const { decodeMovText } = await import("./mov-text.js");
  const text = Buffer.from("é😀 hi end");
  const header = Buffer.alloc(2);
  header.writeUInt16BE(text.length);
  const box = Buffer.alloc(22);
  box.writeUInt32BE(box.length);
  box.write("styl", 4);
  box.writeUInt16BE(1, 8);
  box.writeUInt16BE(3, 10);
  box.writeUInt16BE(5, 12);
  box[16] = 7;
  const decode = (suffix: Uint8Array) => new TextDecoder().decode(decodeMovText(Buffer.concat([header, text, suffix])));
  assert.equal(decode(box), "é😀 <b><i><u>hi</u></i></b> end");
  assert.equal(decode(box.subarray(0, 21)), "é😀 hi end");
  box.writeUInt16BE(2, 8);
  assert.equal(decode(box), "é😀 hi end");
  box.writeUInt32BE(0);
  assert.equal(decode(box), "é😀 hi end");
});

it("preserves encoded timed-text packets and styles for stream copy", () => {
  const bytes = readFileSync(new URL("./fixtures/timed-text-styles.mp4", import.meta.url));
  const doc = parseMp4(bytes, { decodeSubtitles: false });
  const samples = doc.tracks[0]!.samples;
  assert.deepEqual(Array.from(samples[0]!.data), [0, 0]);
  assert.equal(samples.length, 3);
  const copied = parseMp4(serializeMp4(doc), { decodeSubtitles: false });
  assert.deepEqual(copied.tracks[0]!.samples.map(s => s.data), samples.map(s => new Uint8Array(s.data)));
});

for (const [text, plain, runs] of [
  ["Hello <i>World</i>", "Hello World", [[6, 11, 2]]],
  ["é😀 <b>A<i>B</i>C</b> <u>D</u>", "é😀 ABC D", [[3, 4, 1], [4, 5, 3], [5, 6, 1], [7, 8, 4]]],
  ["Plain text", "Plain text", []],
] as const) {
  it(`encodes timed-text emphasis as binary style records: ${text}`, () => {
    const input = new TextEncoder().encode(`1\n00:00:00,500 --> 00:00:01,250\n${text}\n\n2\n00:00:02,000 --> 00:00:03,000\nSecond line\n`);
    const samples = parseMp4(serializeMp4(parseSubtitleDocument(input, "srt")), { decodeSubtitles: false }).tracks[0]!.samples;
    assert.deepEqual(samples.map(s => [s.pts, s.duration]), [[0, 500000], [500000, 750000], [1250000, 750000], [2000000, 1000000]]);
    assert.deepEqual(Array.from(samples[0]!.data), [0, 0]);
    assert.deepEqual(Array.from(samples[2]!.data), [0, 0]);
    const packet = Buffer.from(samples[1]!.data);
    const length = packet.readUInt16BE();
    assert.equal(length, Buffer.byteLength(plain));
    assert.equal(packet.toString("utf8", 2, 2 + length), plain);
    const box = packet.subarray(2 + length);
    if (!runs.length) { assert.equal(box.length, 0); return; }
    assert.equal(box.readUInt32BE(), 10 + 12 * runs.length);
    assert.equal(box.toString("ascii", 4, 8), "styl");
    assert.equal(box.readUInt16BE(8), runs.length);
    runs.forEach(([start, end, flags], i) => {
      const offset = 10 + i * 12;
      assert.deepEqual([box.readUInt16BE(offset), box.readUInt16BE(offset + 2), box.readUInt16BE(offset + 4), box[offset + 6], box[offset + 7], box.readUInt32BE(offset + 8)],
        [start, end, 1, flags, 16, 0xffffffff]);
    });
  });
}
