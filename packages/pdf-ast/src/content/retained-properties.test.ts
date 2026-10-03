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
      } else if ((request.kind === "close-content" || request.kind === "image")) throw new Error("Unexpected nested content");
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
