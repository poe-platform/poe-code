import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { PdfPathSegment, PdfPixelStorage } from "../ast.js";
import { PdfFileSource } from "../source.js";
import { parseContentRangeEvents } from "./range-events.js";
import { StoredPathWriter, readStoredPath } from "./stored-path.js";

function backing() {
  const bytes = new Uint8Array(2 ** 20); let end = 0, peak = 0;
  // Every read borrows the same scratch, detecting clients that retain it.
  const scratch = new Uint8Array(4096);
  const storage: PdfPixelStorage = {
    allocate(length) { const at = end; end += length; return at; },
    async read(at, length) { peak = Math.max(peak, length); scratch.set(bytes.subarray(at, at + length)); return scratch.subarray(0, length); },
    async write(at, value) { peak = Math.max(peak, value.byteLength); bytes.set(value, at); },
  };
  return { storage, peak: () => peak };
}

it("replays interleaved paths from bounded caller-backed blocks", async () => {
  const f = backing(), a = new StoredPathWriter(f.storage), b = new StoredPathWriter(f.storage);
  const expected: PdfPathSegment[] = [];
  for (let i = 0; i < 300; i++) {
    const segment: PdfPathSegment = {kind:"cubic", x1:i, y1:-i, x2:0.5, y2:8, x:2, y:3};
    expected.push(segment); await a.append(segment); await b.append({kind:"close"});
  }
  const first = await a.finish(), second = await b.finish();
  for (let pass = 0; pass < 2; pass++) {
    const actual = []; for await (const segment of readStoredPath(first)) actual.push(segment);
    expect(actual).toEqual(expected);
  }
  let count = 0; for await (const segment of readStoredPath(second)) { expect(segment).toEqual({kind:"close"}); count++; }
  expect(count).toBe(300); expect(f.peak()).toBeLessThanOrEqual(4096);
});

it("spills parser paths without accumulating segments and preserves path grammar", async () => {
  const text = "1 2 m 3 4 l 5 6 7 8 v 9 10 11 12 y h 1 2 3 4 re f " + "1 1 l ".repeat(2000) + "S";
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", new TextEncoder().encode(text));
  const source = await PdfFileSource.open(fs, "/input"), f = backing();
  try {
    let paths = 0;
    for await (const event of parseContentRangeEvents(source, {fs, directory:"/scratch"}, {pathStorage:f.storage})) {
      if (event.kind !== "path-op") continue;
      expect(event.segments).toEqual([]); expect(event.storedSegments).toBeDefined();
      let count = 0; for await (const ignored of readStoredPath(event.storedSegments!)) { void ignored; count++; }
      expect(count).toBe(paths++ === 0 ? 6 : 2000);
    }
    expect(paths).toBe(2); expect(f.peak()).toBeLessThanOrEqual(4096);
  } finally { await source.close(); expect(await fs.readdir("/scratch")).toEqual([]); }
});

it.each([
  "0 0 12 12 re W n -1 0.2 0.1 1 15 1 cm 1 1 12 12 re f*",
  "[2 1] 1 d 2 w 1 J 2 j 2 2 m 10 2 l 10 10 l b*",
  "1 2 m 4 5 6 7 8 9 c 12 4 11 2 v 4 3 2 1 y h B",
  "/Pattern cs /P scn 1 1 12 12 re f",
])("preserves exact retained fill, clip, stroke and pattern pixels: %s", async content => {
  const { cosArray, cosDict, cosName, cosNumber, cosStream, dictSet } = await import("../ast.js");
  const { PdfDocument } = await import("../document.js");
  const { PdfRetainedDocument } = await import("../retained-document.js");
  const { renderDisplayListToBitmap, renderOperationStreamWindow } = await import("../render/raster.js");
  const document = PdfDocument.create(), page = document.addPage();
  const nums = (values: number[]) => cosArray(values.map(value => cosNumber(value)));
  dictSet(page.pageDict,"MediaBox",nums([0,0,16,16]));
  const pattern = cosStream(new TextEncoder().encode("1 0 0 rg 0 0 2 2 re f"), {dict:cosDict({
    Type:cosName("Pattern"),PatternType:cosNumber(1),PaintType:cosNumber(1),TilingType:cosNumber(1),
    BBox:nums([0,0,4,4]),XStep:cosNumber(4),YStep:cosNumber(4),Resources:cosDict(),
  })});
  dictSet(page.pageDict,"Resources",cosDict({Pattern:cosDict({P:document.cos.allocateObject(pattern)})}));
  dictSet(page.pageDict,"Contents",document.cos.allocateObject(cosStream(new TextEncoder().encode(content))));
  const expected = renderDisplayListToBitmap(page.evaluateDisplayList(),{scale:1,transparent:true});
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input",document.save());
  const source = await PdfFileSource.open(fs,"/input"), storage = {fs,directory:"/scratch"};
  const retained = await PdfRetainedDocument.open(source,storage), f = backing();
  try {
    const retainedPage = (await retained.pages().next()).value!;
    const actual = await renderOperationStreamWindow({width:16,height:16}, async function* () {
      for await (const event of retainedPage.evaluateSteps(storage,{imageStorage:f.storage})) {
        if (event.operation.kind === "path") { expect(event.operation.value.segments).toEqual([]); expect(event.operation.value.storedSegments).toBeDefined(); }
        if (!event.captured) yield event.operation;
      }
    },{x:0,y:0,width:16,height:16},{scale:1,transparent:true});
    expect(actual.data).toEqual(expected.data);
  } finally { await retained.close(); await source.close(); expect(await fs.readdir("/scratch")).toEqual([]); }
});

it("preserves storage failures and cancellation identity", async () => {
  const f = backing(), reason = {reason:"stop path"}, controller = new AbortController();
  const writer = new StoredPathWriter(f.storage, controller.signal);
  await writer.append({kind:"move",x:1,y:2}); const path = await writer.finish();
  const work = readStoredPath(path, controller.signal); controller.abort(reason);
  await expect(work.next()).rejects.toBe(reason);
  await expect(new StoredPathWriter(f.storage, controller.signal).append({kind:"close"})).rejects.toBe(reason);
  const failed = new StoredPathWriter({...f.storage, write:async()=>{throw reason;}});
  await failed.append({kind:"close"}); await expect(failed.finish()).rejects.toBe(reason);
});
