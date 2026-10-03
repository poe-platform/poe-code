import { renderOperationStreamWindow, renderDisplayListToBitmap } from "../render/raster.js";
import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosNumber, cosStream, cosString, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";

async function fixture(hideAnnotations = false) {
  const original = PdfDocument.create(); const page = original.addPage();
  const numbers = (values: number[]) => cosArray(values.map(value => cosNumber(value)));
  dictSet(page.pageDict, "MediaBox", numbers([-10, -20, 190, 280])); dictSet(page.pageDict, "Rotate", cosNumber(90));
  const appearance = original.cos.allocateObject(cosStream(cosDict({ BBox: numbers([0, 0, 10, 10]),
    Resources: cosDict({ Font: cosDict({ Ap: cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Courier") }) }) }) }),
    new TextEncoder().encode("q 1 0 0 1 1 2 cm BI /W 1 /H 1 /CS /RGB /BPC 8 ID ABC EI Q BT /Late 8 Tf (appearance) Tj ET")));
  dictSet(page.pageDict, "Annots", cosArray([
    cosDict({ Rect: numbers([10, 20, 40, 80]), AP: cosDict({ N: appearance }) }),
    cosDict({ Rect: numbers([20, 100, 100, 130]), Subtype: cosName("Widget"), V: cosString("widget") }),
    cosDict({ Rect: numbers([100, 100, 110, 110]), AP: cosDict({ N: original.cos.allocateObject(cosStream(cosDict({
      BBox: numbers([0, 0, 10, 10]), Resources: cosDict({ Font: cosDict({ Late: cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Courier-Bold") }) }) }),
    }), new TextEncoder().encode("0 0 10 10 re f"))) }) }),
  ]));
  dictSet(page.pageDict, "Contents", original.cos.allocateObject(cosStream(new TextEncoder().encode("BT /Ap 12 Tf (base) Tj ET"))));
  const expected = page.evaluateDisplayList({ hideAnnotations });
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const readFile = vi.fn(async () => { throw new Error("whole reads forbidden"); });
  const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
    if (key === "readFile") return readFile; const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
  } });
  const source = await PdfFileSource.open(guarded, "/input", { chunkBytes: 32, cacheBytes: 64 });
  const storage = { fs: guarded, directory: "/scratch" }; const document = await PdfRetainedDocument.open(source, storage);
  const retained = (await document.pages().next()).value!;
  return { expected, document, retained, storage, readFile, async close() { await document.close(); await source.close(); expect(await fs.readdir("/scratch")).toEqual([]); } };
}
it.each([false, true])("evaluates complete retained pages with appearance resources and widget text (hide=%s)", async hideAnnotations => {
  const f = await fixture(hideAnnotations); const operations = [];
  for await (const event of f.retained.evaluateSteps(f.storage, { hideAnnotations, chunkBytes: 32 })) if (!event.captured) operations.push(event.operation);
  expect(operations).toEqual(f.expected.operations); expect(f.readFile).not.toHaveBeenCalled(); await f.close();
});
it("closes page and appearance cursors when the consumer returns or throws", async () => {
  const f = await fixture(); const before = await f.storage.fs.readdir("/scratch");
  for (const reject of [false, true]) {
    const work = f.retained.evaluateSteps(f.storage, { chunkBytes: 32 });
    while (true) { const next = await work.next(); if (next.done) throw new Error("Missing appearance image"); if (next.value.operation.kind === "image") break; }
    if (reject) { const error = { reason: "stop" }; await expect(work.throw(error)).rejects.toBe(error); } else await work.return();
    expect(await f.storage.fs.readdir("/scratch")).toEqual(before);
  }
  await f.close();
});

it("rejects appearance preparation before payload reads when resource admission fails", async () => {
  const f = await fixture(); const before = await f.storage.fs.readdir("/scratch"); const decode = vi.spyOn(f.document.objects, "decodeStream");
  const rejection = { reason: "page owner" };
  const work = f.retained.evaluateSteps(f.storage, { onAllocation() { throw rejection; } });
  await expect(work.next()).rejects.toBe(rejection); expect(decode).not.toHaveBeenCalled();
  expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
});
it("preserves appearance decoder failure during resource preparation and cleans staging", async () => {
  const f = await fixture(); const before = await f.storage.fs.readdir("/scratch"); const rejection = { reason: "appearance decoder" }; let closed = false;
  vi.spyOn(f.document.objects, "decodeStream").mockImplementation(async function* () {
    try { yield new TextEncoder().encode("0 0 1 1 re f"); throw rejection; } finally { closed = true; }
  });
  await expect(f.retained.evaluateSteps(f.storage).next()).rejects.toBe(rejection);
  expect(closed).toBe(true); expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
});
it("preserves later resource failures after yielding base-page paint", async () => {
  const f = await fixture(); const before = await f.storage.fs.readdir("/scratch"); const rejection = { reason: "late annotation metadata" };
  const work = f.retained.evaluateSteps(f.storage); await work.next();
  vi.spyOn(f.document, "lookup").mockRejectedValue(rejection);
  let failed = false;
  try { while (!(await work.next()).done) { /* Drain remaining base text. */ } } catch (error) { expect(error).toBe(rejection); failed = true; }
  expect(failed).toBe(true); expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
});
it("stops all page work when cancelled while holding an appearance image", async () => {
  const f = await fixture(); const before = await f.storage.fs.readdir("/scratch"); const controller = new AbortController(); const reason = { reason: "cancel page" };
  const work = f.retained.evaluateSteps(f.storage, { signal: controller.signal });
  while (true) { const next = await work.next(); if (next.done) throw new Error("Missing image"); if (next.value.operation.kind === "image") break; }
  controller.abort(reason); await expect(work.next()).rejects.toBe(reason);
  expect(await f.storage.fs.readdir("/scratch")).toEqual(before); await f.close();
});

it("streams raw page text through retained evaluation and caller staging", async () => {
  const { extractPageFromDisplayList, formatExtractedPageText } = await import("../extract/text.js");
  const f = await fixture(); const options = { mode: "raw" as const };
  const expected = formatExtractedPageText(extractPageFromDisplayList(f.expected, options), options);
  const decoder = new TextDecoder(); let actual = "";
  for await (const chunk of f.retained.streamRawText(f.storage, { chunkBytes: 32 })) actual += decoder.decode(chunk, { stream: true });
  actual += decoder.decode(); expect(actual).toBe(expected); expect(f.readFile).not.toHaveBeenCalled(); await f.close();
});

it("paints retained page operations directly with annotation parity and caller-owned scratch", async () => {
 const f = await fixture();
 const page = {...f.expected, rotation:0 as const};
 const expected = renderDisplayListToBitmap(page, {scale:0.25});
 const operations = async function* () {
  for await (const event of f.retained.evaluateSteps(f.storage, {chunkBytes:32})) if (!event.captured) yield event.operation;
 };
 const actual = await renderOperationStreamWindow(page, operations, {x:0,y:0,width:expected.width,height:expected.height}, {scale:0.25});
 expect(actual).toEqual(expected); expect(f.readFile).not.toHaveBeenCalled(); await f.close();
});
