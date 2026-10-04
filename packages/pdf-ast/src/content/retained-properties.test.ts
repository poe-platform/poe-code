import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosArray, cosDict, cosName, cosNumber, cosString, dictSet } from "../ast.js";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { evaluateContentSteps, evaluateContentStreamSteps } from "./evaluator.js";
import { parseContentStream } from "./parser.js";

it.each(["AllOn", "AnyOn", "AllOff", "AnyOff"])("evaluates retained marked properties and %s visibility with buffered parity", async policy => {
  const original = PdfDocument.create(); original.addPage();
  const on = original.cos.allocateObject(cosDict({ Type: cosName("OCG") }));
  const off = original.cos.allocateObject(cosDict({ Type: cosName("OCG") }));
  const membership = original.cos.allocateObject(cosDict({ Type: cosName("OCMD"), P: cosName(policy), OCGs: cosArray([on, off]) }));
  const actual = original.cos.allocateObject(cosDict({ MCID: cosNumber(7), ActualText: cosString("accessible") }));
  dictSet(original.cos.resolveDict(original.cos.rootRef)!, "OCProperties", cosDict({ D: cosDict({ OFF: cosArray([off]) }) }));
  const resources = cosDict({ Properties: original.cos.allocateObject(cosDict({ Layer: membership, Label: actual })) });
  const nodes = parseContentStream(new TextEncoder().encode("/OC /Layer BDC 0 0 10 10 re f EMC /Span /Label BDC BT /F1 12 Tf (A) Tj ET EMC"));
  const expected = [...evaluateContentStreamSteps({ pageIndex: 0, width: 100, height: 100, cosDoc: original.cos, resourcesDict: resources, nodes })];
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const readFile = vi.fn(() => { throw new Error("whole-file reads forbidden"); });
  const guarded = new Proxy(fs, { get(target, property) {
    if (property === "readFile") return readFile;
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  const source = await PdfFileSource.open(guarded, "/input", { chunkBytes: 64, cacheBytes: 128 });
  const doc = await PdfRetainedDocument.open(source, { fs: guarded, directory: "/scratch" }, { chunkBytes: 64, cacheBytes: 128 });
  const work = evaluateContentSteps({ pageIndex: 0, width: 100, height: 100, resourcesDict: resources });
  const input = nodes[Symbol.iterator](); const actualOperations = [];
  try {
    let step = work.next();
    while (!step.done) {
      const request = step.value;
      if (request.kind === "node") step = work.next(input.next().value);
      else if (request.kind === "font") step = work.next(undefined);
      else if (request.kind === "resolve" || request.kind === "catalog") {
        step = work.next({ kind: "resolved", node: (await doc.lookup(request.kind === "catalog" ? doc.crossReference.rootRef : request.node))?.value });
      } else if ((request.kind === "dash-array" || request.kind === "array-reference" || request.kind === "array-item" || request.kind === "string-bytes" || request.kind === "font-width" || request.kind === "font-unicode" || request.kind === "cmap-lookup" || request.kind === "cmap-character" || request.kind === "truetype-number" || request.kind === "truetype-path" || request.kind === "cid-gid" || request.kind === "frame-push" || request.kind === "frame-pop" || request.kind === "capture-append" || request.kind === "append-clip" || request.kind === "path-append" || request.kind === "path-finish" || request.kind === "transform-path" || request.kind === "close-content" || request.kind === "image" || request.kind === "mask-parameters" || request.kind === "color" || request.kind === "inline-image" || request.kind === "shading")) throw new Error("Unexpected nested content");
      else { actualOperations.push(request); step = work.next(); }
    }
    expect(actualOperations).toEqual(expected);
    expect(actualOperations.filter(event => event.operation.kind === "path")).toHaveLength(policy === "AnyOn" || policy === "AnyOff" ? 1 : 0);
    expect(actualOperations.at(-1)?.operation).toMatchObject({ kind: "glyph", value: { mcid: 7, actualText: "accessible" } });
    expect(readFile).not.toHaveBeenCalled();
  } finally { work.return(); await doc.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("preserves a property read failure while closing an input with failing cleanup", () => {
  const doc = PdfDocument.create(); const failure = new Error("property backend unavailable");
  const nodes = parseContentStream(new TextEncoder().encode("/Span /Label BDC 0 0 10 10 re f EMC"));
  let closed = false;
  doc.cos.resolve = () => { throw failure; };
  const input = { [Symbol.iterator]() { return {
    next() { return { done: false as const, value: nodes[0]! }; },
    return() { closed = true; throw new Error("cleanup failed"); },
  }; } };
  const work = evaluateContentStreamSteps({ pageIndex: 0, width: 100, height: 100, cosDoc: doc.cos, resourcesDict: cosDict({ Properties: cosDict() }), nodes: input });
  expect(() => work.next()).toThrow(failure); expect(closed).toBe(true);
});


it.each(["AllOn", "AnyOn", "AllOff", "AnyOff"].flatMap(policy => [false,true].flatMap(indirect => [false,true].map(annotation => ({policy,indirect,annotation})))))("evaluates caller-backed optional-content lists for %j", async ({policy,indirect,annotation}) => {
  const { PagedStorage } = await import("@poe-code/safe-fs/storage");
  const original = PdfDocument.create(), page = original.addPage();
  const on = original.cos.allocateObject(cosDict({ Type: cosName("OCG") }));
  const off = original.cos.allocateObject(cosDict({ Type: cosName("OCG") }));
  const members = indirect ? original.cos.allocateObject(cosArray([on, off])) : cosArray([on, off]);
  const membership = original.cos.allocateObject(cosDict({ Type: cosName("OCMD"), P: cosName(policy), OCGs: members }));
  dictSet(original.cos.resolveDict(original.cos.rootRef)!, "OCProperties", cosDict({ D: cosDict({ BaseState: cosName("OFF"), ON: indirect ? original.cos.allocateObject(cosArray([on])) : cosArray([on]), OFF: cosArray([off]) }) }));
  dictSet(page.pageDict, "Resources", cosDict({ Properties: cosDict({ Layer: membership }) }));
  if (annotation) {
    const {cosStream} = await import("../ast.js");
    const rect = cosArray([0,0,10,10].map(value=>cosNumber(value)));
    const appearance = original.cos.allocateObject(cosStream(cosDict({BBox:rect}),new TextEncoder().encode("0 0 10 10 re f")));
    dictSet(page.pageDict,"Annots",cosArray([cosDict({Subtype:cosName("Stamp"),Rect:rect,OC:membership,AP:cosDict({N:appearance})})]));
  } else page.setRawContentStream("/OC /Layer BDC 0 0 10 10 re f EMC");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/input", original.save());
  const signal = new AbortController().signal, storage = {fs, directory:"/scratch"}, backing = new PagedStorage({fs,cwd:"/scratch",env:{},signal},4);
  const source = await PdfFileSource.open(fs,"/input"), doc = await PdfRetainedDocument.open(source,storage,{valueArrays:{arrayStorage:backing,storedArrayKeys:["ON","OFF","OCGs"]}});
  try {
    const retained = (await doc.pages().next()).value!; let paths = 0;
    for await (const event of retained.evaluateSteps(storage,{imageStorage:backing})) if(event.operation.kind === "path") paths++;
    expect(paths).toBe(policy === "AnyOn" || policy === "AnyOff" ? 1 : 0);
  } finally { await doc.close(); await source.close(); await backing.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});


it("does not reread the layer selection list for every membership entry", async () => {
  const { PagedStorage } = await import("@poe-code/safe-fs/storage");
  const original=PdfDocument.create(),page=original.addPage();
  const refs=Array.from({length:128},()=>original.cos.allocateObject(cosDict({Type:cosName("OCG")})));
  const membership=original.cos.allocateObject(cosDict({Type:cosName("OCMD"),P:cosName("AllOn"),OCGs:cosArray(refs)}));
  dictSet(original.cos.resolveDict(original.cos.rootRef)!,"OCProperties",cosDict({D:cosDict({BaseState:cosName("OFF"),ON:cosArray(refs)})}));
  dictSet(page.pageDict,"Resources",cosDict({Properties:cosDict({Layer:membership})}));page.setRawContentStream("/OC /Layer BDC 0 0 10 10 re f EMC");
  const fs=createMemoryFileSystem();await fs.mkdir("/scratch");await fs.writeFile("/input",original.save());
  const storage={fs,directory:"/scratch"},signal=new AbortController().signal,backing=new PagedStorage({fs,cwd:"/scratch",env:{},signal},4);
  const read=vi.spyOn(backing,"read");
  const source=await PdfFileSource.open(fs,"/input"),doc=await PdfRetainedDocument.open(source,storage,{valueArrays:{arrayStorage:backing,storedArrayKeys:["ON","OFF","OCGs"]}});
  try{const retained=(await doc.pages().next()).value!;let paths=0;
    for await(const event of retained.evaluateSteps(storage))if(event.operation.kind==="path")paths++;
    expect(paths).toBe(1);expect(read.mock.calls.length).toBeLessThan(128*8);
  }finally{await doc.close();await source.close();await backing.close();}
  expect(await fs.readdir("/scratch")).toEqual([]);
});
