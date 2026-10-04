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
      else if ((step.value.kind === "array-item" || step.value.kind === "string-bytes" || step.value.kind === "font-width" || step.value.kind === "font-unicode" || step.value.kind === "cmap-lookup" || step.value.kind === "cmap-character" || step.value.kind === "truetype-number" || step.value.kind === "truetype-path" || step.value.kind === "cid-gid" || step.value.kind === "frame-push" || step.value.kind === "frame-pop" || step.value.kind === "capture-append" || step.value.kind === "append-clip" || step.value.kind === "path-append" || step.value.kind === "path-finish" || step.value.kind === "transform-path" || step.value.kind === "close-content" || step.value.kind === "image" || step.value.kind === "mask-parameters" || step.value.kind === "color" || step.value.kind === "inline-image" || step.value.kind === "shading")) throw new Error("Unexpected nested content");
      else { if (step.value.operation.kind === "glyph") glyphs.push(step.value.operation.value); step = work.next(); }
    }
    expect(glyphs).toHaveLength(1); expect(glyphs[0]).toMatchObject({ unicode: "Ω", fontName: "Helvetica" });
    expect(f.readFile).not.toHaveBeenCalled();
  } finally { work.return(); await f.close(); }
});

it.each(["unicode","encoding"])("parses growing %s CMap sources without admitting the complete stream",async mode=>{
 const f=await fixture(),lookup=f.doc.lookup.bind(f.doc);
 if(mode==="encoding")vi.spyOn(f.doc,"lookup").mockImplementation(async node=>{
  const value=await lookup(node);
  if(value?.value.kind==="dict"&&value.value.entries.some(entry=>entry.key.decoded==="BaseFont"))return {value:cosDict({Subtype:cosName("Type0"),BaseFont:cosName("Helvetica"),Encoding:f.mapping})};
  return value;
 });
 const tail=new TextEncoder().encode(mode==="unicode"?'1 beginbfchar <41> <03A9> endbfchar':'1 begincidchar <41> 123 endcidchar');
 vi.spyOn(f.doc.objects,"decodeStream").mockImplementation(async function*(){const chunk=new TextEncoder().encode('%'+'x'.repeat(4094)+'\n');for(let i=0;i<32;i++)yield chunk;yield tail;});
 try{
  const font=await resolveRetainedFont(f.doc,{fs:f.fs,directory:"/scratch"},f.resources,"Good",{chunkBytes:4096,onAllocation(bytes){if(bytes===32*4096+tail.length)throw Error("whole CMap source allocation "+bytes);}});
  if(mode==="unicode")expect(font?.cmap?.map.get(65)).toBe("Ω");else expect(font?.encodingCMap?.lookup(65)).toBe(123);
 }finally{await f.close();}
});


it("preserves malformed optional CMap token recovery",async()=>{
 const f=await fixture();vi.spyOn(f.doc.objects,"decodeStream").mockImplementation(async function*(){yield new TextEncoder().encode(')');});
 try{const font=await resolveRetainedFont(f.doc,{fs:f.fs,directory:"/scratch"},f.resources,"Good",{chunkBytes:64});expect(font?.cmap).toBeUndefined();expect(font?.baseFont).toBe("Helvetica");}finally{await f.close();}
});

it("does not recover retained CMap storage failures as optional syntax errors",async()=>{
 const f=await fixture(),failure=new PdfError("E_PARSE","backend read failed"),original=f.fs.openReadFile!.bind(f.fs);
 const fs=new Proxy(f.fs,{get(target,property){if(property==="openReadFile")return async(...args:Parameters<typeof original>)=>{const handle=await original(...args);return new Proxy(handle,{get(object,key){if(key==="read")return async()=>{throw failure;};const value=Reflect.get(object,key);return typeof value==="function"?value.bind(object):value;}});};const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;}});
 try{await expect(resolveRetainedFont(f.doc,{fs,directory:"/scratch"},f.resources,"Good",{chunkBytes:64})).rejects.toBe(failure);}finally{await f.close();}
});
it("does not recover retained CMap token admission rejection",async()=>{
 const f=await fixture(),failure={tokenOwner:true};
 try{await expect(resolveRetainedFont(f.doc,{fs:f.fs,directory:"/scratch"},f.resources,"Good",{chunkBytes:64,onAllocation(bytes){if(bytes===32)throw failure;}})).rejects.toBe(failure);}finally{await f.close();}
});

it.each([new Error('backend'),new PdfError('E_PARSE','backend parse'),new RangeError('backend range')])('does not recover caller storage failures as malformed Unicode: %s',async failure=>{
 const f=await fixture();
 try{await expect(resolveRetainedFont(f.doc,{fs:f.fs,directory:'/scratch'},f.resources,'Good',{chunkBytes:64,resourceStorage:{allocate(){return 0;},async read(){throw failure;},async write(){throw failure;}}})).rejects.toBe(failure);}
 finally{await f.close();}
});

it("keeps retained font widths in caller storage without building resident width records", async () => {
  const { FontWidths } = await import("./widths.js");
  const f = await fixture(), data = new Uint8Array(1024 * 1024);
  let end = 0;
  const storage = {allocate(n:number){const at=end;end+=n;return at;},async read(at:number,n:number){return data.slice(at,at+n);},async write(at:number,bytes:Uint8Array){data.set(bytes,at);}};
  const resident = vi.spyOn(FontWidths.prototype, "set").mockImplementation(() => {throw new Error("resident width record");});
  try {
    const font = await resolveRetainedFont(f.doc, {fs:f.fs,directory:"/scratch"}, f.resources, "Good", {resourceStorage:storage,chunkBytes:64});
    expect(await font!.widths.get(65)).toBe(667);
    expect(await font!.widths.has(65)).toBe(true);
    expect(await font!.widths.get(999)).toBeUndefined();
    expect(resident).not.toHaveBeenCalled();
  } finally {resident.mockRestore();await f.close();}
});
