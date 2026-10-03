import { expect, it } from "vitest";
import type { PdfContentNode } from "../ast.js";
import { evaluateContentStreamSteps } from "./evaluator.js";
import { parseContentStream } from "./parser.js";

it("evaluates paint only as the consumer advances and closes its input on return", () => {
  const path: PdfContentNode = { kind: "path-op", paint: "f", segments: [{ kind: "rect", x: 0, y: 0, width: 10, height: 10 }] };
  let visited = 0, closed = false;
  function* nodes() {
    try { while (true) { visited++; yield path; } }
    finally { closed = true; }
  }
  const work = evaluateContentStreamSteps({ pageIndex: 0, width: 100, height: 100, nodes: nodes() });
  expect(visited).toBe(0);
  const first = work.next();
  expect(first.done).toBe(false); expect(first.value).toMatchObject({ operation: { kind: "path" }, captured: false, insideSoftMask: false });
  expect(visited).toBe(1);
  work.return(); expect(closed).toBe(true); expect(visited).toBe(1);
});

it("yields individual glyphs from one text token", () => {
  const nodes = parseContentStream(new TextEncoder().encode("BT /F1 12 Tf (ABC) Tj ET"));
  const work = evaluateContentStreamSteps({ pageIndex: 0, width: 100, height: 100, nodes });
  for (const unicode of ["A", "B", "C"]) expect(work.next().value).toMatchObject({ operation: { kind: "glyph", value: { unicode } } });
  expect(work.next().done).toBe(true);
});

it("suspends for asynchronous content input between paints", async () => {
  const { evaluateContentSteps } = await import("./evaluator.js");
  const work = evaluateContentSteps({ pageIndex: 0, width: 100, height: 100 });
  expect(work.next().value).toEqual({ kind: "node" });
  const path: PdfContentNode = { kind: "path-op", paint: "f", segments: [{ kind: "rect", x: 0, y: 0, width: 10, height: 10 }] };
  await Promise.resolve();
  expect(work.next(path).value).toMatchObject({ kind: "paint", operation: { kind: "path" } });
  expect(work.next().value).toEqual({ kind: "node" });
  await Promise.resolve();
  expect(work.next(undefined).done).toBe(true);
});

it("closes input when selected-font resolution fails", async () => {
  const { PdfDocument } = await import("../document.js");
  const doc = PdfDocument.create(); const failure = new Error("resource read failed");
  doc.cos.resolve = () => { throw failure; };
  let closed = false;
  const nodes: Iterable<PdfContentNode> = { [Symbol.iterator]() { return {
    next() { return { done: false, value: parseContentStream(new TextEncoder().encode("BT /F1 12 Tf (A) Tj ET"))[0]! }; },
    return() { closed = true; return { done: true, value: undefined }; },
  }; } };
  const work = evaluateContentStreamSteps({ pageIndex: 0, width: 100, height: 100, nodes, cosDoc: doc.cos });
  expect(() => work.next()).toThrow(failure); expect(closed).toBe(true);
});

it("preserves input failures when iterator cleanup also fails", () => {
  const failure = new Error("input read failed");
  const nodes: Iterable<PdfContentNode> = { [Symbol.iterator]() { return {
    next() { throw failure; }, return() { throw new Error("cleanup failed"); },
  }; } };
  const work = evaluateContentStreamSteps({ pageIndex: 0, width: 100, height: 100, nodes });
  expect(() => work.next()).toThrow(failure);
});

it("does not close an already exhausted input iterator again", () => {
  const nodes: Iterable<PdfContentNode> = { [Symbol.iterator]() { return {
    next() { return { done: true, value: undefined }; },
    return() { throw new Error("input already finished"); },
  }; } };
  expect([...evaluateContentStreamSteps({ pageIndex: 0, width: 100, height: 100, nodes })]).toEqual([]);
});

it.each([
  "q 1 0 0 1 20 30 cm /Span << /MCID 7 /ActualText (label) >> BDC BT /F1 12 Tf (AB) Tj 4 0 Td (C) Tj ET EMC Q BT /F1 12 Tf (D) Tj ET",
  "q 1 0 0 1 20 30 cm BT /F1 12 Tf (A) Tj (B) Tj",
  "/Span BMC q 1 0 0 1 20 30 cm EMC BT /F1 12 Tf (A) Tj ET Q BT /F1 12 Tf (B) Tj ET",
  "BT /F1 12 Tf 7 Tr (AB) Tj q (C) Tj Q (D) Tj ET 0 0 10 10 re f",
  "/OC /Hidden BDC q BT /F1 12 Tf (hidden) Tj ET /Span BMC BT (nested) Tj ET EMC Q EMC BT /F1 12 Tf (visible) Tj ET",
])("evaluates streamed group and text events with buffered parity: %s", async source => {
  const { parseContentSteps } = await import("./parser.js");
  const { parseContentOperators } = await import("./operator-parser.js");
  const { evaluateContentSteps } = await import("./evaluator.js");
  const { PdfDocument } = await import("../document.js");
  const { cosArray, cosDict, cosName, dictSet } = await import("../ast.js");
  const doc = PdfDocument.create();
  const layer = doc.cos.allocateObject(cosDict({ Type: cosName("OCG") }));
  dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "OCProperties", cosDict({ D: cosDict({ OFF: cosArray([layer]) }) }));
  const options = { pageIndex: 0, width: 100, height: 100, cosDoc: doc.cos, resourcesDict: cosDict({ Properties: cosDict({ Hidden: layer }) }) };
  const bytes = new TextEncoder().encode(source);
  const expected = [...evaluateContentStreamSteps({ ...options, nodes: parseContentStream(bytes) })];
  const parser = parseContentSteps(), operators = parseContentOperators(bytes);
  let parsing = parser.next();
  const evaluator = evaluateContentSteps(options);
  let evaluating = evaluator.next(); const actual = [];
  while (!evaluating.done) {
    if (evaluating.value.kind === "paint") { actual.push(evaluating.value); evaluating = evaluator.next(); continue; }
    if (evaluating.value.kind === "resolve" || evaluating.value.kind === "catalog") {
      evaluating = evaluator.next({ kind: "resolved", node: doc.cos.resolve(evaluating.value.kind === "catalog" ? doc.cos.rootRef : evaluating.value.node) });
      continue;
    }
    if (evaluating.value.kind === "font") {
      const { resolvePageFonts } = await import("../fonts/resolve.js");
      evaluating = evaluator.next(resolvePageFonts(doc.cos, evaluating.value.resources, evaluating.value.name).get(evaluating.value.name));
      continue;
    }
    while (!parsing.done && parsing.value.kind !== "event") {
      if (parsing.value.kind !== "operator") throw new Error("unexpected inline image");
      const next = operators.next(); parsing = parser.next(next.done ? undefined : next.value);
    }
    await Promise.resolve();
    evaluating = evaluator.next(parsing.done ? undefined : parsing.value.kind === "event" ? parsing.value.event : undefined);
    if (!parsing.done) parsing = parser.next();
  }
  expect(actual).toEqual(expected);
});

it("does not resolve an unused broken font program while evaluating text", async () => {
  const { PdfDocument } = await import("../document.js");
  const { cosDict, cosName, cosStream } = await import("../ast.js");
  const doc = PdfDocument.create();
  const bad = doc.cos.allocateObject(cosDict({ Subtype: cosName("TrueType"), FontDescriptor: cosDict({ FontFile2: doc.cos.allocateObject(cosStream(cosDict({ Filter: cosName("Unsupported") }), new Uint8Array([1]))) }) }));
  const resources = cosDict({ Font: cosDict({ Good: cosDict({ Subtype: cosName("Type1"), BaseFont: cosName("Helvetica") }), Bad: bad }) });
  const nodes = parseContentStream(new TextEncoder().encode("BT /Good 12 Tf (A) Tj ET"));
  const operations = [...evaluateContentStreamSteps({ pageIndex: 0, width: 100, height: 100, nodes, cosDoc: doc.cos, resourcesDict: resources })];
  expect(operations).toHaveLength(1); expect(operations[0]?.operation).toMatchObject({ kind: "glyph", value: { unicode: "A", fontName: "Helvetica" } });
});

it("suspends for the selected font before emitting its glyphs", async () => {
  const { evaluateContentSteps } = await import("./evaluator.js");
  const { PdfDocument } = await import("../document.js");
  const { cosDict, cosName } = await import("../ast.js");
  const { resolvePageFonts } = await import("../fonts/resolve.js");
  const resources = cosDict({ Font: cosDict({ Good: cosDict({ Subtype: cosName("Type1"), BaseFont: cosName("Courier") }) }) });
  const doc = PdfDocument.create(); const font = resolvePageFonts(doc.cos, resources).get("Good")!;
  const nodes = parseContentStream(new TextEncoder().encode("BT /Good 12 Tf (A) Tj ET"));
  const work = evaluateContentSteps({ pageIndex: 0, width: 100, height: 100, resourcesDict: resources });
  expect(work.next().value).toEqual({ kind: "node" });
  expect(work.next(nodes[0]).value).toEqual({ kind: "font", name: "Good", resources });
  await Promise.resolve();
  expect(work.next(font).value).toMatchObject({ kind: "paint", operation: { kind: "glyph", value: { unicode: "A", fontName: "Courier" } } });
  work.return();
});

it("suspends named marked-content properties for retained lookup", async () => {
  const { evaluateContentSteps } = await import("./evaluator.js");
  const { cosDict, cosNumber, cosString, dictGet } = await import("../ast.js");
  const properties = cosDict({ Label: cosDict({ MCID: cosNumber(42), ActualText: cosString("accessible") }) });
  const resources = cosDict({ Properties: properties });
  const work = evaluateContentSteps({ pageIndex: 0, width: 100, height: 100, resourcesDict: resources });
  expect(work.next().value).toEqual({ kind: "node" });
  const nodes = parseContentStream(new TextEncoder().encode("/Span /Label BDC BT /F1 12 Tf (A) Tj ET EMC"));
  let step = work.next(nodes[0]);
  expect(step.value).toEqual({ kind: "resolve", node: properties });
  let reads = 0;
  while (!step.done) {
    if (step.value.kind === "resolve") {
      reads++;
      await Promise.resolve();
      step = work.next({ kind: "resolved", node: step.value.node });
    } else if (step.value.kind === "font") step = work.next(undefined);
    else if (step.value.kind === "paint") {
      expect(step.value.operation).toMatchObject({ kind: "glyph", value: { mcid: 42, actualText: "accessible" } });
      step = work.next();
    } else step = work.next(undefined);
  }
  expect(reads).toBeGreaterThan(0);
  expect(dictGet(resources, "Properties")).toBe(properties);
});
