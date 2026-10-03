import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosNumber, cosStream, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";

const bytes = (s: string) => new TextEncoder().encode(s);
async function fixture(content: string, amend?: (doc: PdfDocument) => void) {
  const original = PdfDocument.create(); const page = original.addPage();
  const image = original.cos.allocateObject(cosStream(cosDict({ Subtype: cosName("Image"), Width: cosNumber(2), Height: cosNumber(1), Filter: cosArray([cosName("ASCIIHexDecode"), cosName("DCTDecode")]) }), bytes("FFD81117FFD9>")));
  const mask = original.cos.allocateObject(cosStream(cosDict({ Subtype: cosName("Image"), Width: cosNumber(2), Height: cosNumber(1) }), new Uint8Array([0, 255])));
  const imageObject = original.cos.resolve(image)!; if (imageObject.kind === "stream") dictSet(imageObject.dict, "SMask", mask);
  const form = original.cos.allocateObject(cosStream(cosDict({ Subtype: cosName("Form"), Matrix: cosArray([2, 0, 0, 3, 0, 0].map(n => cosNumber(n))) }), bytes("/I Do /Cycle Do")));
  const formObject = original.cos.resolve(form)!; if (formObject.kind === "stream") dictSet(formObject.dict, "Resources", cosDict({ XObject: cosDict({ I: image, Cycle: form }) }));
  dictSet(page.pageDict, "Resources", cosDict({ XObject: cosDict({ I: image, M: mask, F: form }) }));
  dictSet(page.pageDict, "Contents", original.cos.allocateObject(cosStream(cosDict(), bytes(content))));
  amend?.(original);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input", { chunkBytes: 64, cacheBytes: 128 });
  const document = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" }, { chunkBytes: 64, cacheBytes: 128 });
  return { document, fs, source, image, async close() { await document.close(); expect(await fs.readdir("/scratch")).toEqual([]); await source.close(); } };
}

it("streams repeated image occurrences with graphics transforms and path-local form cycles", async () => {
  const f = await fixture("q 4 0 0 5 0 0 cm /F Do Q /F Do /I Do");
  const decode = vi.spyOn(f.document.objects, "decodeStream"); const rows = [];
  for await (const image of f.document.images()) {
    expect(decode.mock.calls.filter(call => call[0] === f.image.objectNumber)).toHaveLength(rows.length);
    const raw: number[] = []; for await (const chunk of image.contents({ native: true })) raw.push(...chunk);
    expect(raw).toEqual([255, 216, 17, 23, 255, 217]);
    rows.push([image.pageNumber, image.imageIndex, image.matrix]);
  }
  expect(rows).toEqual([[1, 0, [8, 0, 0, 15, 0, 0]], [1, 1, [2, 0, 0, 3, 0, 0]], [1, 2, [1, 0, 0, 1, 0, 0]]]);
  await f.close();
});

it("keeps inline image ranges alive only during their occurrence", async () => {
  const f = await fixture("BI /W 1 /H 1 /BPC 8 /CS /RGB ID abc EI");
  const images = f.document.images(); const first = (await images.next()).value;
  expect(first?.inline).toBe(true);
  const raw: number[] = []; for await (const chunk of first!.contents()) raw.push(...chunk);
  expect(raw).toEqual([97, 98, 99]);
  await images.next();
  await expect(first!.contents().next()).rejects.toThrow("expired");
  await f.close(); expect((await images.next()).done).toBe(true);
});

it("spills deep graphics saves and excludes referenced masks from fallback enumeration", async () => {
  const f = await fixture(`${"q 2 0 0 2 0 0 cm ".repeat(70)}/I Do ${"Q ".repeat(70)}/I Do`);
  const matrices = []; for await (const image of f.document.images()) matrices.push(image.matrix);
  expect(matrices).toEqual([[2 ** 70, 0, 0, 2 ** 70, 0, 0], [1, 0, 0, 1, 0, 0]]); await f.close();
});

it("finds unreferenced resource images and selects pages", async () => {
  const f = await fixture("", doc => { doc.addPage(); });
  const rows = []; for await (const image of f.document.images({ firstPage: 1, lastPage: 1 })) rows.push(image.matrix);
  expect(rows).toEqual([[2, 0, 0, 1, 0, 0]]);
  const empty = []; for await (const image of f.document.images({ firstPage: 2 })) empty.push(image);
  expect(empty).toEqual([]); await f.close();
});

it("walks patterns, Type 3 glyphs and selected normal annotation appearances in order", async () => {
  const f = await fixture("/I Do", doc => {
    const page = doc.getPage(0); const resources = doc.cos.resolveDict(page.pageDict.entries.find(entry => entry.key.decoded === "Resources")!.value)!;
    const stream = () => doc.cos.allocateObject(cosStream(cosDict(), bytes("/I Do")));
    dictSet(resources, "Pattern", cosDict({ P: stream() }));
    dictSet(resources, "Font", cosDict({ F: cosDict({ Subtype: cosName("Type3"), CharProcs: cosDict({ A: stream() }) }) }));
    dictSet(page.pageDict, "Annots", cosArray([cosDict({ AP: cosDict({ N: cosDict({ On: stream(), Off: stream() }), R: stream() }) })]));
  });
  const rows = []; for await (const image of f.document.images()) rows.push(image.imageIndex);
  expect(rows).toEqual([0, 1, 2, 3, 4]); await f.close();
});

it("cleans suspended content and graphics-state staging on early return and cancellation", async () => {
  const f = await fixture(`${"q ".repeat(100)}/I Do`);
  const images = f.document.images(); const first = (await images.next()).value!;
  expect(first.inline).toBe(false); expect((await f.fs.readdir("/scratch")).length).toBeGreaterThan(0);
  await images.return(); await expect(first.contents().next()).rejects.toThrow("expired");
  const again = f.document.images(); await again.next(); await f.close(); expect((await again.next()).done).toBe(true);
});

it("propagates storage failure and cleans partially staged content", async () => {
  const f = await fixture("/I Do");
  vi.spyOn(f.fs, "createStagedFile").mockRejectedValueOnce(new Error("external quota"));
  await expect(f.document.images().next()).rejects.toThrow("external quota"); await f.close();
});

it.each([8192, 262144])("walks %i generated content bytes with external staging and no retained payload", async length => {
  const f = await fixture("/I Do");
  const { walkRetainedImages } = await import("./retained-images.js");
  const page = (await f.document.pages().next()).value!;
  const pattern = bytes("% padded content\n"); const ending = bytes("\n/I Do");
  const byteAt = (at: number) => at < length ? pattern[at % pattern.length]! : ending[at - length]!;
  async function* content() {
    const scratch = new Uint8Array(64);
    for (let at = 0; at < length + ending.length; at += scratch.length) {
      const count = Math.min(scratch.length, length + ending.length - at);
      for (let i = 0; i < count; i++) scratch[i] = byteAt(at + i);
      yield scratch.subarray(0, count);
    }
  }
  vi.spyOn(page, "streamContents").mockImplementation(content);
  vi.spyOn(f.document, "pages").mockImplementation(async function* () { yield page; });
  const scope = {}; let outstanding = 0; let peak = 0;
  type Run = { size: number; revision: number; path: string };
  const live = new Map<string, Run>();
  const stat = (run: Run) => ({ type: "file" as const, size: run.size, identityScope: scope, opaqueIdentity: run.path,
    revision: run.revision, mode: 0o600, mtimeMs: run.revision, ctimeMs: run.revision, atimeMs: 0 });
  const fs = {
    capabilities: { retainedRead: true, retainedStagingWrite: true, retainedStagingCleanup: true },
    stat: async () => ({ type: "directory", size: 0 }),
    async createStagedFile(path: string) {
      const run = { size: 0, revision: 0, path }; live.set(path, run);
      return { file: { path, stat: stat(run) }, cleanup: { remove: async () => { live.delete(path); }, close: async () => {} }, writer: {
        async write(chunk: Uint8Array) {
          outstanding += chunk.length; peak = Math.max(peak, outstanding); expect(chunk.buffer.byteLength).toBeLessThanOrEqual(64);
          await Promise.resolve();
          let valid = true; for (const value of chunk) if (value !== byteAt(run.size++)) valid = false;
          expect(valid).toBe(true);
          run.revision++; outstanding -= chunk.length;
        }, finish: async () => stat(run),
      } };
    },
    async openReadFile(path: string) {
      const run = live.get(path)!;
      return { stat: async () => stat(run), close: async () => {}, async read(at: number, count: number) {
        expect(count).toBeLessThanOrEqual(64); return Uint8Array.from({ length: Math.min(count, run.size - at) }, (_, i) => byteAt(at + i));
      } };
    },
    readFile() { throw new Error("whole read forbidden"); }, writeFile() { throw new Error("whole write forbidden"); },
  } as unknown as import("@poe-code/safe-fs/contracts").FileSystem;
  let images = 0;
  for await (const image of walkRetainedImages(f.document, { fs, directory: "/external" }, { chunkBytes: 64, maxDepth: 10 })) {
    expect(image.reference).toMatchObject(f.image); images++;
  }
  expect(images).toBe(1); expect(peak).toBeLessThanOrEqual(64); expect(live.size).toBe(0); await f.close();
});

it("extracts unchanged native JPEG bytes from an encrypted document", async () => {
  const { readFileSync } = await import("node:fs");
  const jpeg = readFileSync(new URL("../fixtures/jpeg-RGB-0-0-17.jpg", import.meta.url));
  const original = PdfDocument.create(); const page = original.addPage();
  const handle = original.embedJpeg(jpeg);
  const name = page.ensureXObjectResource(handle.xobjectRef);
  page.setRawContentStream(`/${name} Do`);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  await fs.writeFile("/input", original.save({ encrypt: { revision: 3, userPassword: "secret" } }));
  const source = await PdfFileSource.open(fs, "/input");
  const document = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" }, { password: "secret", chunkBytes: 64 });
  let count = 0;
  for await (const image of document.images()) {
    const output: number[] = []; for await (const chunk of image.contents({ native: true })) { expect(chunk.buffer.byteLength).toBeLessThanOrEqual(64); output.push(...chunk); }
    expect(Uint8Array.from(output)).toEqual(new Uint8Array(jpeg)); count++;
  }
  expect(count).toBe(1); await document.close(); await source.close(); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("admits content staging before writes and removes it when cancelled", async () => {
  const f = await fixture("/I Do"); const { walkRetainedImages } = await import("./retained-images.js");
  const before = await f.fs.readdir("/scratch");
  await expect(walkRetainedImages(f.document, { fs: f.fs, directory: "/scratch" }, { maxDepth: 10, maxStagingBytes: 1 }).next()).rejects.toThrow("limit");
  expect(await f.fs.readdir("/scratch")).toEqual(before);
  const abort = new AbortController();
  const page = (await f.document.pages().next()).value!;
  vi.spyOn(f.document, "pages").mockImplementation(async function* () { yield page; });
  let returned = false;
  vi.spyOn(page, "streamContents").mockImplementation(async function* () {
    try { yield bytes("q "); abort.abort(new Error("cancel content")); yield bytes("/I Do"); } finally { returned = true; }
  });
  await expect(walkRetainedImages(f.document, { fs: f.fs, directory: "/scratch" }, { maxDepth: 10, signal: abort.signal }).next()).rejects.toThrow("cancel content");
  expect(returned).toBe(true); expect(await f.fs.readdir("/scratch")).toEqual(before); await f.close();
});
it("exposes retained raw bytes for inline and XObject decoder recovery", async () => {
  const f = await fixture("/I Do BI /W 1 /H 1 /F /Unsupported ID abc EI");
  const result: string[] = [];
  for await (const image of f.document.images()) {
    const raw: number[] = []; for await (const chunk of image.contents({ raw: true })) raw.push(...chunk);
    result.push(new TextDecoder().decode(new Uint8Array(raw)));
  }
  expect(result).toEqual(["FFD81117FFD9>", "abc"]); await f.close();
});
