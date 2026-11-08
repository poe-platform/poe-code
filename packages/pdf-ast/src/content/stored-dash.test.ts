import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosNumber, cosRef, dictSet, type PdfPixelStorage } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import { renderRetainedPagePixels } from "../render/retained-page-pixels.js";
import { storedStrokeDash } from "../render/stored-dash.js";
import { storeDashArray } from "./stored-dash.js";

function backing() {
  const data = new Uint8Array(8 * 1024 * 1024), loan = new Uint8Array(4096);
  let end = 19, peakRead = 0, peakWrite = 0;
  const storage: PdfPixelStorage = {
    allocate(n) { const at = end; end += n; if (end > data.length) throw Error("Fixture full"); return at; },
    async read(at, n) { peakRead = Math.max(peakRead, n); expect(n).toBeLessThanOrEqual(4096); loan.fill(193); loan.set(data.subarray(at, at + n)); return loan.subarray(0, n); },
    async write(at, bytes) { peakWrite = Math.max(peakWrite, bytes.length); data.set(bytes, at); }
  };
  return { storage, get peakRead() { return peakRead; }, get peakWrite() { return peakWrite; } };
}

it.each([513, 8193])("normalizes %i distances using bounded writes and borrowed reads", async count => {
  const f = backing();
  const input = cosArray(Array.from({ length: count }, (_, i) => i % 3 ? cosNumber(i % 3 === 1 ? -2 : 3) : cosRef(1)));
  const dash = (await storeDashArray(input, f.storage, async () => cosNumber(2)))!;
  const expected = Array.from({ length: count }, (_, i) => i % 3 === 0 ? 2 : i % 3 === 1 ? -2 : 3).filter(n => n >= 0);
  let pending: (() => Promise<void>) | undefined;
  const reader = storedStrokeDash(dash, 2, function* (action) { pending = action; yield null; });
  expect(reader.length).toBe(expected.length);
  expect(reader.total).toBe(expected.reduce((sum, n) => sum + n, 0) * 2);
  for (const index of [0, expected.length - 1, 0, 512, 1].filter(i => i < expected.length)) {
    const work = reader.get(index); let step = work.next();
    while (!step.done) { await pending!(); pending = undefined; step = work.next(); }
    expect(step.value).toBe(expected[index]! * 2);
  }
  expect(f.peakRead).toBeLessThanOrEqual(4096); expect(f.peakWrite).toBeLessThanOrEqual(4096);
});

it.each(["failure", "abort"])("preserves dash backing %s identity", async mode => {
  const reason = { message: mode }, controller = new AbortController(), f = backing();
  const storage = { ...f.storage, async write() { if (mode === "failure") throw reason; controller.abort(reason); } };
  await expect(storeDashArray(cosArray([cosNumber(2)]), storage, async node => node, controller.signal)).rejects.toBe(reason);
});

it.each([
  ["1 2", -3, false], ["0.1 0.2 0.3", 6.6, false], ["0 2 1", 4, false], ["0 0", 0, false],
  ["-1 2 null 3", 1, false], ["0 2 1", -5, true], ["0 2 1", -5, "indirect"],
  ["1 2 ".repeat(512) + "3", 3071, false]
] as const)("preserves retained dash pixels and state (case %#)", async (pattern, phase, ext) => {
  const original = PdfDocument.create(), page = original.addPage([24, 16]);
  const values = pattern.trim().split(" ").filter(Boolean).map(value => value === "null" ? { kind: "null" as const } : cosNumber(Number(value)));
  const patternNode = cosArray(values);
  const dashNode = cosArray([ext === "indirect" ? original.cos.allocateObject(patternNode) : patternNode, cosNumber(phase)]);
  dictSet(page.pageDict, "Resources", cosDict({ ExtGState: cosDict({ Dashes: cosDict({ D: ext === "indirect" ? original.cos.allocateObject(dashNode) : dashNode }) }) }));
  page.setRawContentStream(`0.3 w 1 J ${ext ? "/Dashes gs" : `[${pattern}] ${phase} d`} q 2 0 0 0.5 0 0 cm 1 4 m 10 4 l S Q 1 10 m 22 10 l S [] 0 d 1 14 m 22 14 l S`);
  const expected = page.renderToBitmap({ scale: 1 }).data;
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input"), storage = { fs, directory: "/scratch" };
  const f = backing();
  const document = await PdfRetainedDocument.open(source, storage, { valueArrays: { arrayStorage: f.storage, storedArrayKeys: ["D"] } });
  try {
    const retained = (await document.pages().next()).value!;
    const image = await renderRetainedPagePixels(retained, storage, { scale: 1, tileSize: 24, imageStorage: f.storage });
    const actual = new Uint8Array(expected.length); let offset = 0;
    for await (const chunk of image.pixels) { actual.set(chunk, offset); offset += chunk.length; }
    expect(actual).toEqual(expected);
    expect(f.peakRead).toBeLessThanOrEqual(4096); expect(f.peakWrite).toBeLessThanOrEqual(4096);
  } finally { await document.close(); await source.close(); expect(await fs.readdir("/scratch")).toEqual([]); }
});
