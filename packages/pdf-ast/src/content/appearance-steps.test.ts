import { expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, cosStream, cosString, dictGet, dictSet, type PdfContentNode } from "../ast.js";
import { PdfDocument } from "../document.js";
import { evaluateContentStreamToDisplayList } from "./evaluator.js";
import { parseContentStream } from "./parser.js";
import { preparePageAppearanceSteps } from "./appearance.js";

it.each([false, true])("preserves transformed appearances, resource precedence and widget fallbacks (hide=%s)", async hideAnnotations => {
  const doc = PdfDocument.create(); const page = doc.addPage();
  const numbers = (values: number[]) => cosArray(values.map(value => cosNumber(value)));
  const stream = doc.cos.allocateObject(cosStream(cosDict({ BBox: numbers([5, 10, 25, 20]), Matrix: numbers([0, 1, -1, 0, 10, 20]),
    Resources: cosDict({ Font: cosDict({ ApFont: cosDict({ Type: cosName("Font"), Subtype: cosName("Type1"), BaseFont: cosName("Courier") }) }) }) }),
    new TextEncoder().encode("0 1 0 rg 5 10 20 10 re f BT /ApFont 8 Tf (appearance) Tj ET")));
  dictSet(page.pageDict, "Contents", doc.cos.allocateObject(cosStream(new TextEncoder().encode("BT /ApFont 10 Tf (base) Tj ET"))));
  const parent = doc.cos.allocateObject(cosDict({ V: cosString("fallback") }));
  dictSet(page.pageDict, "Annots", cosArray([
    cosDict({ Rect: numbers([20, 30, 60, 90]), AP: cosDict({ N: cosDict({ On: stream }) }), AS: cosName("On"), Subtype: cosName("Widget") }),
    cosDict({ Rect: numbers([40, 50, 80, 70]), Parent: parent }),
    cosDict({ Rect: numbers([0, 0, 10, 10]), F: cosNumber(2), V: cosString("hidden"), Subtype: cosName("Widget") }),
    cosDict({ Rect: numbers([0, 0, 10, 10]), AP: cosDict({ N: doc.cos.allocateObject(cosStream(new Uint8Array())) }), V: cosString("empty fallback"), Subtype: cosName("Widget") }),
  ]));
  const expected = page.evaluateDisplayList({ hideAnnotations });
  const resources = cosDict(); const nodes: PdfContentNode[] = [...page.getContentAst()]; let appearance: PdfContentNode[] = [];
  const work = preparePageAppearanceSteps(page.pageDict, page.getResourcesDict(), resources, hideAnnotations);
  let step = work.next();
  while (!step.done) {
    await Promise.resolve(); const request = step.value;
    if (request.kind === "resolve" || request.kind === "catalog") step = work.next(doc.cos.resolve(request.kind === "catalog" ? doc.cos.rootRef : request.node));
    else if (request.kind === "dictionary-merge" || request.kind === "array-reference" || request.kind === "array-item") throw new TypeError("Stored visibility requires asynchronous evaluation");
      else if (request.kind === "appearance-content") { appearance = parseContentStream(doc.cos.decodeStream(request.stream)); step = work.next(appearance.length > 0); }
    else {
      nodes.push(request.stream ? { kind: "graphics-group", ops: [...request.nodes, ...appearance] } : request.nodes[0]!);
      step = work.next();
    }
  }
  const actual = evaluateContentStreamToDisplayList({ pageIndex: 0, width: 612, height: 792, origin: [0, 0], nodes, cosDoc: doc.cos, resourcesDict: resources });
  expect(actual.operations).toEqual(expected.operations);
  expect(actual.glyphs.map(glyph => glyph.unicode).join("")).toEqual(expected.glyphs.map(glyph => glyph.unicode).join(""));
  if (!hideAnnotations) expect(dictGet(resources, "Font")).toBeDefined();
});


it.each(["XObject", "Properties", "ExtGState", "ColorSpace", "Pattern", "Shading"])("shares immutable %s backing without copying unused resources", key => {
  const unexpected = () => { throw new Error("Unused backing must not be accessed"); };
  const storedEntries = { storage: { allocate: unexpected, read: unexpected, write: unexpected }, position: 0, length: 1000 };
  const source = { ...cosDict(), storedEntries };
  const resources = cosDict();
  const work = preparePageAppearanceSteps(cosDict(), cosDict({ [key]: source }), resources);
  let step = work.next();
  while (!step.done) {
    expect(step.value.kind).toBe("resolve");
    if (step.value.kind !== "resolve") throw new Error("Unused resource map was copied");
    step = work.next(step.value.node);
  }
  const copy = dictGet(resources, key);
  expect(copy).not.toBe(source);
  expect(copy?.kind).toBe("dict");
  if (copy?.kind !== "dict") throw new Error("Missing resource map");
  expect(copy.storedEntries).toBe(storedEntries);
  expect(source.entries).toEqual([]);
});
