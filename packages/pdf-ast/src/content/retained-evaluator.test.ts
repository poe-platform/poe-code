import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosNumber, cosStream, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfStagingStorage } from "../staging-budget.js";
import { PdfFileSource } from "../source.js";
import { evaluateContentStreamSteps } from "./evaluator.js";
import { evaluateRetainedContentSteps } from "./retained-evaluator.js";
import { parseContentEvents } from "./parser.js";

async function fixture(indirectInlineFilter: boolean | "direct" = false) {
  const original = PdfDocument.create(); const page = original.addPage();
  const filter = indirectInlineFilter === true ? original.cos.allocateObject(cosName("ASCIIHexDecode")) : undefined;
  const inline = filter ? `/F ${filter.objectNumber} 0 R ID 414243>` : indirectInlineFilter === "direct" ? "/F /AHx ID 414243>" : "ID ABC";
  const bytes = new TextEncoder().encode(`q /Fm Do Q BT /F1 12 Tf 10 20 Td (hello) Tj ET q 2 0 0 2 20 20 cm BI /W 1 /H 1 /CS /RGB /BPC 8 ${inline} EI Q`);
  const form = original.cos.allocateObject(cosStream(cosDict({ Type: cosName("XObject"), Subtype: cosName("Form"), BBox: cosArray([0, 0, 10, 10].map(n => cosNumber(n))) }), new TextEncoder().encode("0 1 0 rg 0 0 10 10 re f")));
  const resources = cosDict({ Font: cosDict({ F1: cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Helvetica") }) }), XObject: cosDict({ Fm: form }) });
  dictSet(page.pageDict, "Resources", resources); dictSet(page.pageDict, "Contents", original.cos.allocateObject(cosStream(bytes)));
  const params = { pageIndex: 0, width: 612, height: 792, resourcesDict: resources };
  const expected = Array.from(evaluateContentStreamSteps({ ...params, nodes: parseContentEvents(bytes), cosDoc: original.cos }));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const wholeRead = vi.fn(async () => { throw new Error("whole reads forbidden"); });
  const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, property) {
    if (property === "readFile") return wholeRead;
    const value = Reflect.get(fs, property); return typeof value === "function" ? value.bind(fs) : value;
  } });
  const source = await PdfFileSource.open(guarded, "/input", { chunkBytes: 32, cacheBytes: 64 });
  const storage = { fs: guarded, directory: "/scratch" }; const document = await PdfRetainedDocument.open(source, storage);
  const retainedPage = (await document.pages().next()).value!;
  const retainedParams = { ...params, resourcesDict: (await retainedPage.attributes()).resources };
  return { document, storage, retainedPage, params: retainedParams, expected, wholeRead, contentBytes: bytes.length,
    async close() { await document.close(); await source.close(); expect(await fs.readdir("/scratch")).toEqual([]); } };
}
it("evaluates Forms, text and borrowed inline images through retained resources", async () => {
  const f = await fixture(); const actual = [];
  for await (const operation of evaluateRetainedContentSteps(f.document, f.retainedPage.streamContents(), f.params, f.storage, { chunkBytes: 32 })) actual.push(operation);
  expect(actual).toEqual(f.expected); expect(f.wholeRead).not.toHaveBeenCalled(); await f.close();
});
it("closes root and nested content staging when the consumer returns early", async () => {
  const f = await fixture(); const before = await f.storage.fs.readdir("/scratch");
  const work = evaluateRetainedContentSteps(f.document, f.retainedPage.streamContents(), f.params, f.storage, { chunkBytes: 32 });
  expect((await work.next()).done).toBe(false); await work.return();
  expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
});
it("preserves cancellation and resource-owner failures while cleaning staging", async () => {
  const f = await fixture(); const rejection = { reason: "cancel evaluation" }; const abort = new AbortController();
  const before = await f.storage.fs.readdir("/scratch");
  const work = evaluateRetainedContentSteps(f.document, f.retainedPage.streamContents(), f.params, f.storage, { chunkBytes: 32, signal: abort.signal });
  await work.next(); abort.abort(rejection); await expect(work.next()).rejects.toBe(rejection);
  expect(await f.storage.fs.readdir("/scratch")).toEqual(before);
  const limited = evaluateRetainedContentSteps(f.document, f.retainedPage.streamContents(), f.params, f.storage, { maxResourceBytes: 1 });
  await expect(limited.next()).rejects.toThrow("limit");
  expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
});

it("does not resolve later resources while the consumer holds an operation", async () => {
  const f = await fixture(); const lookup = vi.spyOn(f.document, "lookup");
  const shared = new PdfStagingStorage(f.storage, 65536);
  const work = evaluateRetainedContentSteps(f.document, f.retainedPage.streamContents(), f.params, shared, { chunkBytes: 32 });
  await work.next(); const count = lookup.mock.calls.length;
  expect(shared.liveBytes).toBeGreaterThan(f.contentBytes);
  await Promise.resolve(); await Promise.resolve();
  expect(lookup.mock.calls.length).toBe(count);
  await work.return(); expect(shared.liveBytes).toBe(0); await f.close();
});
it("shares staging admission across simultaneously open content cursors", async () => {
  const f = await fixture(); const before = await f.storage.fs.readdir("/scratch");
  const work = evaluateRetainedContentSteps(f.document, f.retainedPage.streamContents(), f.params, f.storage, { chunkBytes: 32, maxStagingBytes: f.contentBytes + 1 });
  await expect(work.next()).rejects.toThrow("staging byte limit");
  expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
});
it.each([undefined, NaN, { reason: "late decode" }])("preserves arbitrary decoder failure identity: %s", async rejection => {
  const f = await fixture(); const before = await f.storage.fs.readdir("/scratch"); let closed = false;
  vi.spyOn(f.document.objects, "decodeStream").mockImplementation(async function* () {
    try { yield new TextEncoder().encode("0 0 1 1 re f"); throw rejection; } finally { closed = true; }
  });
  const work = evaluateRetainedContentSteps(f.document, f.retainedPage.streamContents(), f.params, f.storage);
  await expect(work.next()).rejects.toBe(rejection); expect(closed).toBe(true);
  expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
});

it.each([true, "direct"] as const)("preserves inline filter decoding and malformed-reference fallback: %s", async filter => {
  const f = await fixture(filter); const actual = [];
  for await (const operation of evaluateRetainedContentSteps(f.document, f.retainedPage.streamContents(), f.params, f.storage)) actual.push(operation);
  expect(actual).toEqual(f.expected);
  const image = actual.find(operation => operation.operation.kind === "image")?.operation;
  if (image?.kind !== "image") throw new Error("Expected inline image");
  expect(image.value.decodedRgba).toEqual(new Uint8Array(filter === "direct" ? [65, 66, 67, 255] : [52, 49, 52, 255]));
  await f.close();
});

it("preserves a containing owner's rejection after a yielded operation", async () => {
  const f = await fixture(); const before = await f.storage.fs.readdir("/scratch"); const rejection = { reason: "parent budget" }; let rejecting = false;
  const work = evaluateRetainedContentSteps(f.document, f.retainedPage.streamContents(), f.params, f.storage, { onAllocation() { if (rejecting) throw rejection; } });
  await work.next(); rejecting = true; await expect(work.next()).rejects.toBe(rejection);
  expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
});
it.each([0, 1])("preserves output with a font cache capacity of %s", async maxCachedFonts => {
  const f = await fixture(); const actual = [];
  for await (const operation of evaluateRetainedContentSteps(f.document, f.retainedPage.streamContents(), f.params, f.storage, { maxCachedFonts })) actual.push(operation);
  expect(actual).toEqual(f.expected); await f.close();
});
it.each([false, true])("attempts every cursor cleanup and preserves primary failure: %s", async primaryFailure => {
  const f = await fixture(); const cleanupFailure = { reason: "remove receipt" }, primary = { reason: "consumer" }; let removals = 0;
  const originalFs = f.storage.fs;
  const fs = new Proxy(Object.create(originalFs) as typeof originalFs, { get(_target, property) {
    if (property === "createStagedFile") return async (...args: Parameters<NonNullable<typeof originalFs.createStagedFile>>) => {
      const staged = await originalFs.createStagedFile!(...args); const cleanup = staged.cleanup!;
      return { ...staged, cleanup: {
        async remove(...options: Parameters<typeof cleanup.remove>) { await cleanup.remove(...options); removals++; throw cleanupFailure; },
        close: () => cleanup.close(),
      } };
    };
    const value = Reflect.get(originalFs, property); return typeof value === "function" ? value.bind(originalFs) : value;
  } });
  const work = evaluateRetainedContentSteps(f.document, f.retainedPage.streamContents(), f.params, { fs, directory: "/scratch" });
  await work.next();
  await expect(primaryFailure ? work.throw(primary) : work.return()).rejects.toBe(primaryFailure ? primary : cleanupFailure);
  expect(removals).toBeGreaterThanOrEqual(2); await f.close();
});
