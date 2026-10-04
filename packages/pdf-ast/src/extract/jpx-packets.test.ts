import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { JpxImage } from "../vendor/pdfjs-image-decoders.mjs";
import { PdfRetainedJpx } from "./retained-jpx.js";
import { PdfFileSource } from "../source.js";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";

function packetFixture(side: number) {
  const original = new Uint8Array(readFileSync(new URL("../fixtures/rgb-lossless.j2k", import.meta.url)));
  let siz = -1, cod = -1, sot = -1, sod = -1;
  for (let i = 0; i < original.length - 1; i++) if (original[i] === 255) {
    if (original[i + 1] === 81) siz = i + 2;
    if (original[i + 1] === 82) cod = i + 2;
    if (original[i + 1] === 144) sot = i + 2;
    if (original[i + 1] === 147) { sod = i + 2; break; }
  }
  const seen = new Set<string>();
  let bits = "1";
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    let i = x, j = y, width = side, height = side, level = 0, fresh = 0;
    while (true) {
      const key = `${level}:${i}:${j}`;
      if (seen.has(key)) break;
      seen.add(key); fresh++;
      if (width === 1 && height === 1) break;
      i >>= 1; j >>= 1; width = Math.ceil(width / 2); height = Math.ceil(height / 2); level++;
    }
    bits += "1".repeat(fresh * 2) + "00000";
  }
  const header: number[] = [];
  let value = 0, left = 8;
  for (const bit of bits) {
    value = (value << 1) | Number(bit);
    if (--left === 0) { header.push(value); left = value === 255 ? 7 : 8; value = 0; }
  }
  if (left !== 8) header.push(value << left);
  const bytes = new Uint8Array(sod + header.length * 3 + 2);
  bytes.set(original.subarray(0, sod));
  for (let i = 0; i < 3; i++) bytes.set(header, sod + header.length * i);
  bytes.set([255, 217], bytes.length - 2);
  const view = new DataView(bytes.buffer);
  for (const offset of [4, 8, 20, 24]) view.setUint32(siz + offset, side * 4);
  view.setUint32(sot + 4, 14 + header.length * 3);
  bytes[cod + 7] = 0; bytes[cod + 8] = 0; bytes[cod + 9] = 0;
  return { bytes, sod, headerEnd: sod + header.length - 1 };
}

it.each([17, 33])("backs queued packet descriptors for a square precinct with %s codeblocks per side", async (side) => {
  const { bytes, sod, headerEnd } = packetFixture(side);
  const reference = new JpxImage(); reference.failOnCorruptedImage = true; reference.parse(bytes);
  expect(reference.width).toBe(side * 4);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", bytes);
  const source = await PdfFileSource.open(fs, "/input");
  const storage = new PagedStorage({ fs, cwd: "/scratch", env: {}, signal: new AbortController().signal }, 2);
  const checkpoint = { reason: "end of packet header" };
  let parsingHeader = false, admitted = 0;
  const original = JpxImage.prototype.parseSteps;
  const parse = vi.spyOn(JpxImage.prototype, "parseSteps").mockImplementation(function* (this: JpxImage, data) {
    const steps = original.call(this, data);
    try {
      let next = steps.next();
      while (!next.done) {
        if (typeof next.value === "number" && next.value >= sod) {
          parsingHeader = true;
          if (next.value >= headerEnd) throw checkpoint;
        }
        next = steps.next(yield next.value);
      }
    } finally { steps.return(); }
  });
  try {
    await expect(PdfRetainedJpx.open(source, { coefficientStorage: storage, onDecoderAllocation(length) {
      if (parsingHeader) {
        admitted += length;
        if (admitted > 16384) throw Error("resident packet queue");
      }
    } })).rejects.toBe(checkpoint);
  } finally { parse.mockRestore(); await storage.close(); await source.close(); }
});

it("replays queued payload offsets with exact pixels and owned cleanup", async () => {
  const { decodeJpxToRgba } = await import("./images.js");
  const { bytes } = packetFixture(5);
  const expected = decodeJpxToRgba(bytes);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", bytes);
  const source = await PdfFileSource.open(fs, "/input");
  const storage = new PagedStorage({ fs, cwd: "/scratch", env: {}, signal: new AbortController().signal }, 1);
  const opened = vi.spyOn(fs, "open");
  try {
    const image = await PdfRetainedJpx.open(source, { coefficientStorage: storage });
    try {
      const actual = new Uint8Array(expected.length); let offset = 0;
      for await (const row of image.rows()) { actual.set(row, offset); offset += row.length; }
      expect(actual).toEqual(expected);
      expect(opened).toHaveBeenCalled();
    } finally { image.close(); }
  } finally {
    await storage.close(); await source.close();
    for (const result of opened.mock.results) if (result.type === "return") {
      await expect((await result.value).stat()).rejects.toMatchObject({ code: "EBADF" });
    }
    expect(await fs.readdir("/scratch")).toEqual([]);
  }
});
