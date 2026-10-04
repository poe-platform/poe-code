import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { JpxImage } from "../vendor/pdfjs-image-decoders.mjs";

function precinctFixture(size: number) {
  const original = new Uint8Array(readFileSync(new URL("../fixtures/rgb-lossless.j2k", import.meta.url)));
  let siz = -1, cod = -1, sot = -1, sod = -1;
  for (let i = 0; i < original.length - 1; i++) if (original[i] === 255) {
    if (original[i + 1] === 81) siz = i + 2;
    if (original[i + 1] === 82) cod = i + 2;
    if (original[i + 1] === 144) sot = i + 2;
    if (original[i + 1] === 147) { sod = i + 2; break; }
  }
  const bytes = new Uint8Array(sod + 3);
  bytes.set(original.subarray(0, sod)); bytes.set([128, 255, 217], sod);
  const view = new DataView(bytes.buffer);
  for (const offset of [4, 8, 20, 24]) view.setUint32(siz + offset, size);
  view.setUint32(sot + 4, 15);
  bytes[cod + 7] = 0; bytes[cod + 8] = 0; bytes[cod + 9] = 0;
  return bytes;
}

it.each([1, 8])("backs large precinct tree values using %s-byte elements before allocation", (elementBytes) => {
  const bytes = precinctFixture(1028);
  const Native = Uint8Array;
  vi.stubGlobal("Uint8Array", new Proxy(Native, { construct(target, args) {
    if (typeof args[0] === "number" && args[0] > 65536) throw Error("resident precinct tree");
    return Reflect.construct(target, args);
  } }));
  const decoder = new JpxImage(undefined, undefined, { storedPlanes: true });
  decoder.failOnCorruptedImage = true;
  const steps = decoder.parseSteps(bytes);
  try {
    let next = steps.next();
    while (!next.done) {
      const request = next.value;
      if (typeof request !== "number" && "kind" in request) {
        if (request.kind !== "vector-allocate") throw Error("unexpected tree request");
        expect(request.length).toBeLessThanOrEqual(257 * 257 * elementBytes);
        if (request.length === 257 * 257 * elementBytes) return;
        next = steps.next(0);
        continue;
      }
      next = steps.next(typeof request === "number" ? bytes[request] : bytes.subarray(request.start, request.end));
    }
    throw Error("precinct tree was not backed");
  } finally { steps.return(); vi.unstubAllGlobals(); }
});


it("uses caller storage for growing precinct trees and releases scratch on a later failure", async () => {
  const { createMemoryFileSystem } = await import("@poe-code/safe-fs");
  const { PagedStorage } = await import("@poe-code/safe-fs/storage");
  const { PdfFileSource } = await import("../source.js");
  const { PdfRetainedJpx } = await import("./retained-jpx.js");
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  const size = 516, count = (size / 4) ** 2;
  await fs.writeFile("/input", precinctFixture(size));
  const source = await PdfFileSource.open(fs, "/input");
  const storage = new PagedStorage({ fs, cwd: "/scratch", env: {}, signal: new AbortController().signal }, 2);
  const opened = vi.spyOn(fs, "open");
  const stopped = { reason: "wavelet checkpoint" };
  const allocations: number[] = [];
  let largestWrite = 0;
  try {
    await expect(PdfRetainedJpx.open(source, { coefficientStorage: {
      allocate(length) {
        if (length === size * size * 4) throw stopped;
        allocations.push(length);
        return storage.allocate(length);
      },
      read: storage.read.bind(storage),
      async write(at, bytes) {
        largestWrite = Math.max(largestWrite, bytes.length);
        await storage.write(at, bytes);
      }
    } })).rejects.toBe(stopped);
    expect(allocations).toContain(count);
    expect(allocations).toContain(count * 8);
    expect(largestWrite).toBeLessThanOrEqual(4096);
    expect(opened).toHaveBeenCalled();
  } finally {
    await storage.close(); await source.close();
    for (const result of opened.mock.results) if (result.type === "return") {
      const handle = await result.value;
      await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
    }
    expect(await fs.readdir("/scratch")).toEqual([]);
  }
});
