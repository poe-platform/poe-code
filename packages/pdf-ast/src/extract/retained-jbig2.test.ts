import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PdfError } from "../errors.js";
import { Jbig2Image } from "../vendor/pdfjs-image-decoders.mjs";
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
it("admits JBIG2 arithmetic contexts before allocation", () => {
  const bytes = fixture("jbig2-generic-stream.bin"); const allocations: number[] = [];
  const decoder = new Jbig2Image(undefined, size => { allocations.push(size); if (size >= 65536) throw new PdfError("E_LIMIT", "context budget"); });
  expect(() => decoder.parseChunks([{ data: bytes, start: 0, end: bytes.length }])).toThrow("context budget");
  expect(Math.max(...allocations)).toBeGreaterThanOrEqual(65536);
});

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfFileSource } from "../source.js";
import { PdfRetainedJbig2 } from "./retained-jbig2.js";
import { decodeJbig2ToRgba } from "./images.js";
import { vi } from "vitest";
async function source(bytes: Uint8Array) { const fs = createMemoryFileSystem(); await fs.writeFile("/jbig", bytes); return PdfFileSource.open(fs, "/jbig", { chunkBytes: 31, cacheBytes: 62 }); }
it.each(["jbig2-generic.jb2", "jbig2-generic-stream.bin", "jbig2-mmr-stream.bin", "jbig2-symbols.0000"])("emits owned rows matching buffered %s", async name => {
  const bytes = fixture(name); const globals = name.includes("symbols") ? fixture("jbig2-symbols.sym") : undefined;
  const input = await source(bytes); const globalSource = globals ? await source(globals) : undefined;
  const expected = decodeJbig2ToRgba(bytes, 64, 32, globals);
  const image = await PdfRetainedJbig2.open(input, 64, 32, { globals: globalSource }); await input.close(); await globalSource?.close();
  const result: number[] = []; for await (const row of image.rows()) { expect(row.buffer.byteLength).toBe(256); result.push(...row); }
  expect(result).toEqual([...expected]); image.close(); await expect(image.rows().next()).rejects.toThrow("closed");
});
it("admits input and globals before reads, and row scratch before allocation", async () => {
  const input = await source(fixture("jbig2-symbols.0000")); const globals = await source(fixture("jbig2-symbols.sym")); const read = vi.spyOn(input, "read");
  await expect(PdfRetainedJbig2.open(input, 64, 32, { globals, maxWorkingBytes: input.size + globals.size - 1 })).rejects.toThrow("limit"); expect(read).not.toHaveBeenCalled();
  const measured = await PdfRetainedJbig2.open(input, 64, 32, { globals }); const base = measured.decoderBytes; measured.close();
  const tight = await PdfRetainedJbig2.open(input, 64, 32, { globals, maxWorkingBytes: base + 255 }); await expect(tight.rows().next()).rejects.toThrow("limit"); tight.close();
  const bounded = await PdfRetainedJbig2.open(input, 64, 32, { globals, maxWorkingBytes: base + 256 }); let count = 0; for await (const row of bounded.rows()) { expect(row.length).toBe(256); count++; } expect(count).toBe(32); bounded.close();
  await input.close(); await globals.close();
});
it("cancels between rows and validates output dimensions", async () => {
  const input = await source(fixture("jbig2-generic-stream.bin"));
  await expect(PdfRetainedJbig2.open(input, 64, 32, { maxOutputBytes: 8191 })).rejects.toThrow("limit");
  await expect(PdfRetainedJbig2.open(input, 64, 31)).rejects.toThrow("dimensions");
  const controller = new AbortController(); const image = await PdfRetainedJbig2.open(input, 64, 32, { signal: controller.signal }); const rows = image.rows(); await rows.next();
  controller.abort(new Error("cancel jbig")); await expect(rows.next()).rejects.toThrow("cancel jbig"); image.close(); await input.close();
});
it("keeps standalone bitmaps packed without allocating a gray pixel plane", () => {
  const data = fixture("jbig2-generic.jb2"); const sizes: number[] = []; const decoder = new Jbig2Image(undefined, n => { sizes.push(n); });
  const full = decoder.parse(data); const fullCharges = sizes.reduce((a, b) => a + b, 0); sizes.length = 0;
  const packed = decoder.parse(data, { packed: true });
  expect(packed.length).toBe(Math.ceil(decoder.width / 8) * decoder.height);
  expect(fullCharges - sizes.reduce((a, b) => a + b, 0)).toBe(full.length + 128);
});
it("propagates allocation failures through globals, symbols and region decoding", () => {
  const data = fixture("jbig2-symbols.0000"), globals = fixture("jbig2-symbols.sym");
  const chunks = [{ data: globals, start: 0, end: globals.length }, { data, start: 0, end: data.length }]; const sizes: number[] = [];
  new Jbig2Image(undefined, n => { sizes.push(n); }).parseChunks(chunks); expect(sizes.length).toBeGreaterThan(20);
  for (const stopAt of [0, Math.floor(sizes.length / 3), Math.floor(sizes.length * 2 / 3), sizes.length - 1]) {
    let count = 0; const stopped = new PdfError("E_LIMIT", `allocation ${stopAt}`);
    expect(() => new Jbig2Image(undefined, () => { if (count++ === stopAt) throw stopped; }).parseChunks(chunks)).toThrow(stopped);
    expect(count).toBe(stopAt + 1);
  }
});
