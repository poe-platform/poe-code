import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosDict, cosName, cosStream } from "../ast.js";
import { PdfError } from "../errors.js";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { resolveRetainedFont } from "./retained.js";

async function fixture() {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const original = PdfDocument.create(); original.addPage();
  const mapping = original.cos.allocateObject(cosStream(new TextEncoder().encode("1 beginbfchar <41> <03A9> endbfchar"), { compress: true }));
  const good = original.cos.allocateObject(cosDict({ Subtype: cosName("Type1"), BaseFont: cosName("Helvetica"), ToUnicode: mapping }));
  const bad = original.cos.allocateObject(cosDict({ Subtype: cosName("TrueType"), FontDescriptor: cosDict({ FontFile2: original.cos.allocateObject(cosStream(cosDict({ Filter: cosName("Unsupported") }), new Uint8Array([1]))) }) }));
  await fs.writeFile("/input", original.save());
  const source = await PdfFileSource.open(fs, "/input", { chunkBytes: 64, cacheBytes: 128 });
  const doc = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" }, { chunkBytes: 64, cacheBytes: 128 });
  const resources = cosDict({ Font: cosDict({ Good: good, Bad: bad }) });
  const readFile = vi.fn(async () => { throw new Error("whole file reads forbidden"); });
  const guarded = new Proxy(fs, { get(target, property) {
    if (property === "readFile") return readFile;
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  return { fs: guarded, source, doc, resources, readFile, mapping, async close() { await doc.close(); await source.close(); expect(await fs.readdir("/scratch")).toEqual([]); } };
}

it("resolves only the requested font through retained objects and staged streams", async () => {
  const f = await fixture(); let admitted = 0;
  const decode = vi.spyOn(f.doc.objects, "decodeStream");
  try {
    const font = await resolveRetainedFont(f.doc, { fs: f.fs, directory: "/scratch" }, f.resources, "Good", { chunkBytes: 64, onAllocation(bytes) { admitted += bytes; } });
    expect(font?.baseFont).toBe("Helvetica"); expect(font?.cmap?.map.get(65)).toBe("Ω");
    expect(font?.standardOutlines?.getGlyphOutline(65).length).toBeGreaterThan(0);
    expect(decode.mock.calls).toEqual([[f.mapping.objectNumber, f.mapping.generationNumber]]);
    expect(admitted).toBeGreaterThan(0); expect(f.readFile).not.toHaveBeenCalled();
    expect(await f.fs.readdir("/scratch")).toHaveLength(1);
  } finally { await f.close(); }
});

it("rejects working admission before decoding a font stream", async () => {
  const f = await fixture(); const decode = vi.spyOn(f.doc.objects, "decodeStream");
  try {
    await expect(resolveRetainedFont(f.doc, { fs: f.fs, directory: "/scratch" }, f.resources, "Good", { chunkBytes: 64, maxWorkingBytes: 1 })).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(decode).not.toHaveBeenCalled();
  } finally { await f.close(); }
});

it("cleans staging on limit rejection without recovering it as an optional CMap", async () => {
  const f = await fixture();
  try {
    await expect(resolveRetainedFont(f.doc, { fs: f.fs, directory: "/scratch" }, f.resources, "Good", { chunkBytes: 64, maxStagingBytes: 1 })).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(await f.fs.readdir("/scratch")).toHaveLength(1);
  } finally { await f.close(); }
});

it("preserves backend errors and cancellation while decoding an optional map", async () => {
  const f = await fixture(); const failure = new Error("backend unavailable");
  const decode = vi.spyOn(f.doc.objects, "decodeStream").mockImplementation(async function* () { yield new Uint8Array([1]); throw failure; });
  try {
    await expect(resolveRetainedFont(f.doc, { fs: f.fs, directory: "/scratch" }, f.resources, "Good", { chunkBytes: 64 })).rejects.toBe(failure);
    expect(await f.fs.readdir("/scratch")).toHaveLength(1);
    const controller = new AbortController();
    decode.mockImplementation(async function* () { yield new Uint8Array([1]); controller.abort(failure); yield new Uint8Array([2]); });
    await expect(resolveRetainedFont(f.doc, { fs: f.fs, directory: "/scratch" }, f.resources, "Good", { chunkBytes: 64, signal: controller.signal })).rejects.toBe(failure);
    expect(await f.fs.readdir("/scratch")).toHaveLength(1);
  } finally { await f.close(); }
});

it("preserves malformed optional-map decoding recovery", async () => {
  const f = await fixture();
  vi.spyOn(f.doc.objects, "decodeStream").mockImplementation(async function* () { yield new Uint8Array([1]); throw new PdfError("E_PARSE", "malformed stream"); });
  try {
    const font = await resolveRetainedFont(f.doc, { fs: f.fs, directory: "/scratch" }, f.resources, "Good", { chunkBytes: 64 });
    expect(font?.baseFont).toBe("Helvetica"); expect(font?.cmap).toBeUndefined();
    expect(await f.fs.readdir("/scratch")).toHaveLength(1);
  } finally { await f.close(); }
});

it("supplies a retained font to evaluation without a buffered document", async () => {
  const { evaluateContentSteps } = await import("../content/evaluator.js");
  const { parseContentStream } = await import("../content/parser.js");
  const f = await fixture();
  const nodes = parseContentStream(new TextEncoder().encode("BT /Good 12 Tf (A) Tj ET"))[Symbol.iterator]();
  const work = evaluateContentSteps({ pageIndex: 0, width: 100, height: 100, resourcesDict: f.resources });
  const glyphs = [];
  try {
    let step = work.next();
    while (!step.done) {
      if (step.value.kind === "node") { const next = nodes.next(); step = work.next(next.done ? undefined : next.value); }
      else if (step.value.kind === "font") step = work.next(await resolveRetainedFont(f.doc, { fs: f.fs, directory: "/scratch" }, step.value.resources, step.value.name, { maxWorkingBytes: 8 * 1024 * 1024, chunkBytes: 64 }));
      else if (step.value.kind === "resolve" || step.value.kind === "catalog") step = work.next({ kind: "resolved", node: (await f.doc.lookup(step.value.kind === "catalog" ? f.doc.crossReference.rootRef : step.value.node))?.value });
      else { if (step.value.operation.kind === "glyph") glyphs.push(step.value.operation.value); step = work.next(); }
    }
    expect(glyphs).toHaveLength(1); expect(glyphs[0]).toMatchObject({ unicode: "Ω", fontName: "Helvetica" });
    expect(f.readFile).not.toHaveBeenCalled();
  } finally { work.return(); await f.close(); }
});
