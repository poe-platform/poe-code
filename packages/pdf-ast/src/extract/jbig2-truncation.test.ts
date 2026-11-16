import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Jbig2Image } from "../vendor/pdfjs-image-decoders.mjs";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfFileSource } from "../source.js";
import { PdfRetainedJbig2 } from "./retained-jbig2.js";

const fixture = new Uint8Array(readFileSync(new URL("../fixtures/jbig2-generic-stream.bin", import.meta.url)));

it.each([1, 5, 6, 10, 20, 29])("rejects a segment cut at byte %i in buffered and retained decoding", async end => {
  for (const storedBitmap of [false, true]) {
    const steps = new Jbig2Image(undefined, undefined, { storedBitmap }).parseChunksSteps([{ data: fixture, start: 0, end }]);
    expect(() => {
      let step = steps.next();
      while (!step.done) {
        if (!("position" in step.value)) throw new Error("visited truncated payload");
        expect(step.value.position).toBeLessThan(end);
        step = steps.next(fixture[step.value.position]);
      }
    }).toThrow("truncated segment");
  }
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", fixture.subarray(0, end));
  const source = await PdfFileSource.open(fs, "/input");
  try {
    await expect(PdfRetainedJbig2.open(source, 64, 32)).rejects.toThrow(end < 11 ? "Invalid JBIG2 stream" : "truncated segment");
  } finally { await source.close(); }
});

it.each([6, 8, 9, 10, 13, 17])("bounds extended reference headers to chunk end %i before reading or allocating references", end => {
  const bytes = new Uint8Array(100);
  bytes[4] = 48;
  new DataView(bytes.buffer).setUint32(5, 0xe0000008);
  expect(() => new Jbig2Image().parseChunks([{ data: bytes, start: 0, end }])).toThrow("truncated segment header");
});

// The payload follows both headers in random-access files, rather than each header.
function randomAccess(truncated: boolean) {
  const bytes = new Uint8Array(9 + 22 + (truncated ? 9 : 19));
  bytes.set([0x97, 0x4a, 0x42, 0x32, 13, 10, 26, 10, 2]);
  bytes.set(fixture.subarray(0, 11), 9);
  bytes[24] = 51;
  bytes.set(fixture.subarray(11, truncated ? 20 : 30), 31);
  return bytes;
}
it.each([false, true])("validates random-access payload ranges (truncated=%s)", async truncated => {
  const bytes = randomAccess(truncated);
  if (truncated) expect(() => new Jbig2Image().parse(bytes)).toThrow("truncated segment payload");
  else expect(new Jbig2Image().parse(bytes)).toHaveLength(64 * 32);
  const fs = createMemoryFileSystem(); await fs.writeFile("/input", bytes);
  const source = await PdfFileSource.open(fs, "/input");
  try {
    if (truncated) await expect(PdfRetainedJbig2.open(source, 64, 32)).rejects.toThrow("truncated segment payload");
    else { const image = await PdfRetainedJbig2.open(source, 64, 32); image.close(); }
  } finally { await source.close(); }
});

it("bounds unknown-length segment terminators to the supplied chunk", () => {
  const bytes = new Uint8Array(fixture.length + 4);
  bytes.set(fixture);
  new DataView(bytes.buffer).setUint32(37, 0xffffffff);
  new DataView(bytes.buffer).setUint32(fixture.length, 32);
  const expected = new Jbig2Image().parseChunks([{ data: fixture, start: 0, end: fixture.length }]);
  expect(new Jbig2Image().parseChunks([{ data: bytes, start: 0, end: bytes.length }])).toEqual(expected);
  expect(() => new Jbig2Image().parseChunks([{ data: bytes, start: 0, end: bytes.length - 1 }])).toThrow("segment end was not found");
});
