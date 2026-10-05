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
  expect(step.value).toEqual({ kind: "resolve", node: properties, arrayPathPrefix: ["Resources", "Properties"] });
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

it("suspends nested Form content with a distinct cursor per invocation", async () => {
  const { evaluateContentSteps } = await import("./evaluator.js");
  const { PdfDocument } = await import("../document.js");
  const { cosDict, cosName, cosStream } = await import("../ast.js");
  const doc = PdfDocument.create();
  const form = cosStream(cosDict({ Subtype: cosName("Form") }), new TextEncoder().encode("0 0 10 10 re f"));
  const resources = cosDict({ XObject: cosDict({ F: form }) });
  doc.cos.decodeStream = () => { throw new Error("evaluator must request nested input from the driver"); };
  const work = evaluateContentSteps({ pageIndex: 0, width: 100, height: 100, cosDoc: doc.cos, resourcesDict: resources });
  expect(work.next().value).toEqual({ kind: "node" });
  function resolveObjects(step: ReturnType<typeof work.next>) {
    while (!step.done && step.value.kind === "resolve") step = work.next({ kind: "resolved", node: doc.cos.resolve(step.value.node) });
    return step;
  }
  const first = resolveObjects(work.next({ kind: "xobject", name: "F" }));
  expect(first.value).toMatchObject({ kind: "node", source: { stream: form } });
  const path = parseContentStream(new TextEncoder().encode("0 0 10 10 re f"))[0]!;
  expect(work.next(path).value).toMatchObject({ kind: "paint", operation: { kind: "path" } });
  expect(work.next().value).toEqual(first.value);
  expect(work.next(undefined).value).toEqual({ kind: "node" });
  const second = resolveObjects(work.next({ kind: "xobject", name: "F" }));
  expect(second.value).toMatchObject({ kind: "node", source: { stream: form } });
  if (first.value?.kind !== "node" || second.value?.kind !== "node") throw new Error("expected content cursors");
  expect(second.value.source).not.toBe(first.value.source);
  work.return();
});

it.each([false, true])("closes all nested cursors and preserves primary failure: %s", async fail => {
  const { vi } = await import("vitest");
  const parser = await import("./parser.js");
  const { PdfDocument } = await import("../document.js");
  const { cosDict, cosName, cosStream, dictSet } = await import("../ast.js");
  const doc = PdfDocument.create();
  const form = cosStream(cosDict({ Subtype: cosName("Form") }), new Uint8Array());
  const resources = cosDict({ XObject: cosDict({ F: form }) });
  dictSet(form.dict, "Resources", resources);
  const failure = new Error("nested read failed");
  let opened = 0, closed = 0, rootClosed = false;
  function failCleanup(): never { throw new Error("nested cleanup failed"); }
  const spy = vi.spyOn(parser, "parseContentEvents").mockImplementation(function* () {
    const level = ++opened;
    try {
      if (level === 1) yield { kind: "xobject", name: "F" };
      else if (fail) throw failure;
      else yield { kind: "path-op", paint: "f", segments: [{ kind: "rect", x: 0, y: 0, width: 10, height: 10 }] };
    } finally { closed++; if (fail && level === 1) failCleanup(); }
  });
  function* nodes() { try { yield { kind: "xobject" as const, name: "F" }; } finally { rootClosed = true; } }
  const work = evaluateContentStreamSteps({ pageIndex: 0, width: 100, height: 100, cosDoc: doc.cos, resourcesDict: resources, nodes: nodes() });
  try {
    if (fail) expect(() => work.next()).toThrow(failure);
    else { expect(work.next().value).toMatchObject({ operation: { kind: "path" } }); work.return(); }
    expect(opened).toBe(2); expect(closed).toBe(2); expect(rootClosed).toBe(true);
  } finally { spy.mockRestore(); }
});

it.each([[0, false], [3, false], [0, true], [3, true]] as const)("requests Type3 width and content through one cursor in render mode %s, empty %s", async (mode, empty) => {
  const { evaluateContentSteps } = await import("./evaluator.js");
  const { PdfDocument } = await import("../document.js");
  const { cosDict, cosNumber, cosStream } = await import("../ast.js");
  const doc = PdfDocument.create(); const stream = cosStream(new TextEncoder().encode("500 0 d0 0 0 10 10 re f"));
  doc.cos.decodeStream = () => { throw new Error("Type3 decoding belongs to the input driver"); };
  const font: import("../fonts/resolve.js").ResolvedPageFont = {
    name: "T3", baseFont: "Custom", subtype: "Type3", isTwoByteCid: false,
    differences: new Map(), glyphNames: new Map([[65, "A"]]), widths: new Map(), defaultWidth: 1000,
    charProcs: cosDict({ A: stream }), fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
  };
  const work = evaluateContentSteps({ pageIndex: 0, width: 100, height: 100 });
  work.next();
  expect(work.next(parseContentStream(new TextEncoder().encode(`BT /T3 10 Tf ${mode} Tr (AA) Tj ET`))[0]).value).toMatchObject({ kind: "font" });
  let step = work.next(font); const positions: number[] = []; let closes = 0;
  const seen = new Map<object, number>();
  while (!step.done) {
    const request = step.value;
    if (request.kind === "node" && request.source) {
      const count = seen.get(request.source) ?? 0; seen.set(request.source, count + 1);
      await Promise.resolve();
      step = work.next(!empty && count === 0 ? { kind: "state-op", operator: "d0", operands: [cosNumber(500), cosNumber(0)] } : undefined);
    } else if (request.kind === "resolve") step = work.next({ kind: "resolved", node: doc.cos.resolve(request.node) });
    else if (request.kind === "close-content") { closes++; step = work.next(); }
    else if (request.kind === "font") step = work.next(font);
    else if (request.kind === "paint") {
      if (request.operation.kind === "glyph") positions.push(request.operation.value.matrix[4]);
      step = work.next();
    } else step = work.next(undefined);
  }
  expect(positions).toEqual([0, empty ? 10 : 5]); expect(seen.size).toBe(2);
  expect(closes).toBe(mode === 3 && !empty ? 2 : 0);
  expect([...seen.values()]).toEqual(mode === 3 || empty ? [1, 1] : [2, 2]);
});

it.each([false, true])("releases an invisible Type3 cursor without consuming its program: cleanup failure %s", async fail => {
  const { vi } = await import("vitest");
  const parser = await import("./parser.js");
  const { PdfDocument } = await import("../document.js");
  const { cosArray, cosDict, cosName, cosNumber, cosStream } = await import("../ast.js");
  const doc = PdfDocument.create();
  const resources = cosDict({ Font: cosDict({ T3: cosDict({ Subtype: cosName("Type3"),
    Encoding: cosDict({ Differences: cosArray([cosNumber(65), cosName("A")]) }),
    CharProcs: cosDict({ A: cosStream(new Uint8Array()) }),
  }) }) });
  const parsed = parseContentStream(new TextEncoder().encode("BT /T3 10 Tf 3 Tr (AA) Tj ET"));
  const failure = new Error("cursor close failed");
  function failCleanup(): never { throw failure; }
  let closed = 0, readPastWidth = false, inputClosed = false;
  const spy = vi.spyOn(parser, "parseContentEvents").mockImplementation(function* () {
    try {
      yield { kind: "state-op", operator: "d0", operands: [cosNumber(500), cosNumber(0)] };
      readPastWidth = true;
      yield { kind: "path-op", paint: "f", segments: [] };
    } finally { closed++; if (fail) failCleanup(); }
  });
  function* input() { try { yield* parsed; } finally { inputClosed = true; } }
  const work = evaluateContentStreamSteps({ pageIndex: 0, width: 100, height: 100, cosDoc: doc.cos, resourcesDict: resources, nodes: input() });
  try {
    if (fail) expect(() => [...work]).toThrow(failure);
    else expect([...work]).toHaveLength(2);
    expect(closed).toBe(fail ? 1 : 2); expect(readPastWidth).toBe(false); expect(inputClosed).toBe(true);
  } finally { spy.mockRestore(); }
});

it("evaluates transformed clipped Forms with asynchronous metadata and no buffered document", async () => {
  const { evaluateContentSteps } = await import("./evaluator.js");
  const { PdfDocument } = await import("../document.js");
  const { cosArray, cosDict, cosName, cosNumber, cosStream, cosBool } = await import("../ast.js");
  const { parseContentEvents } = await import("./parser.js");
  const doc = PdfDocument.create();
  const numbers = (values: number[]) => cosArray(values.map(value => doc.cos.allocateObject(cosNumber(value))));
  const inner = doc.cos.allocateObject(cosStream(cosDict({ Subtype: cosName("Form") }), new TextEncoder().encode("0 0 5 5 re f")));
  const form = doc.cos.allocateObject(cosStream(cosDict({ Subtype: cosName("Form"),
    Matrix: doc.cos.allocateObject(numbers([1, 0, 0, 1, 12, 14])), BBox: numbers([0, 0, 20, 20]),
    Group: doc.cos.allocateObject(cosDict({ S: cosName("Transparency"), I: cosBool(true) })),
  }), new TextEncoder().encode("0 1 0 rg 0 0 40 40 re f /Inner Do")));
  const resources = cosDict({ XObject: doc.cos.allocateObject(cosDict({ F: form, Inner: inner })) });
  const nodes = parseContentStream(new TextEncoder().encode("/F Do /F Do"));
  const expected = [...evaluateContentStreamSteps({ pageIndex: 0, width: 100, height: 100, cosDoc: doc.cos, resourcesDict: resources, nodes })];
  const work = evaluateContentSteps({ pageIndex: 0, width: 100, height: 100, resourcesDict: resources });
  const cursors = new Map<object, Iterator<import("./parser.js").PdfContentEvent>>();
  const input = nodes[Symbol.iterator](), actual = [];
  let reads = 0, step = work.next();
  try {
    while (!step.done) {
      const request = step.value;
      await Promise.resolve();
      if (request.kind === "resolve" || request.kind === "catalog") {
        reads++; step = work.next({ kind: "resolved", node: doc.cos.resolve(request.kind === "catalog" ? doc.cos.rootRef : request.node) });
      } else if (request.kind === "node") {
        let cursor = request.source ? cursors.get(request.source) : input;
        if (!cursor && request.source) { cursor = parseContentEvents(doc.cos.decodeStream(request.source.stream)); cursors.set(request.source, cursor); }
        const next = cursor!.next();
        if (next.done && request.source) cursors.delete(request.source);
        step = work.next(next.done ? undefined : next.value);
      } else if (request.kind === "paint") { actual.push(request); step = work.next(); }
      else throw new Error(`Unexpected request: ${request.kind}`);
    }
    expect(actual).toEqual(expected); expect(actual.filter(event => event.operation.kind === "path")).toHaveLength(4); expect(reads).toBeGreaterThan(10); expect(cursors.size).toBe(0);
  } finally { work.return(); for (const cursor of cursors.values()) cursor.return?.(); }
});

it("requests XObject image decoding and preserves placement with no buffered document", async () => {
  const { evaluateContentSteps } = await import("./evaluator.js");
  const { cosDict, cosName, cosStream } = await import("../ast.js");
  const stream = cosStream(cosDict({ Subtype: cosName("Image") }), new Uint8Array());
  const resources = cosDict({ XObject: cosDict({ Im: stream }) });
  const nodes = parseContentStream(new TextEncoder().encode("0 .5 1 rg 2 0 0 3 4 5 cm /Im Do"))[Symbol.iterator]();
  const work = evaluateContentSteps({ pageIndex: 0, width: 100, height: 100, resourcesDict: resources });
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
  let decoded = 0, painted = 0, step = work.next();
  while (!step.done) {
    const request = step.value;
    if (request.kind === "node") step = work.next(nodes.next().value);
    else if (request.kind === "resolve") step = work.next({ kind: "resolved", node: request.node });
    else if (request.kind === "image") {
      expect(request).toEqual({ kind: "image", stream, resources, fillColor: { r: 0, g: .5, b: 1, alpha: 1 } });
      decoded++; await Promise.resolve();
      step = work.next({ kind: "decoded-image", image: { width: 2, height: 1, bitsPerComponent: 8, colorSpace: "rgb", rgba } });
    } else if (request.kind === "paint") {
      painted++;
      expect(request.operation).toMatchObject({ kind: "image", value: { matrix: [2, 0, 0, 3, 4, 5], width: 2, height: 1, decodedRgba: rgba } });
      step = work.next();
    } else throw new Error(`Unexpected request: ${request.kind}`);
  }
  expect(decoded).toBe(1); expect(painted).toBe(1);
});

it.each([false, true])("resolves ExtGState asynchronously, including font, styles and soft mask: %s", async maskEnabled => {
  const { evaluateContentSteps } = await import("./evaluator.js");
  const { PdfDocument } = await import("../document.js");
  const { cosArray, cosDict, cosName, cosNumber, cosStream } = await import("../ast.js");
  const { resolvePageFonts } = await import("../fonts/resolve.js");
  const { parseContentEvents } = await import("./parser.js");
  const doc = PdfDocument.create();
  const number = (value: number) => doc.cos.allocateObject(cosNumber(value));
  const maskForm = cosStream(cosDict({ Subtype: cosName("Form"), Group: cosDict({ CS: cosName("DeviceRGB") }) }), new TextEncoder().encode("0 0 5 5 re f"));
  const mask = cosDict({ S: cosName("Alpha"), G: doc.cos.allocateObject(maskForm), BC: cosArray([number(.2), number(.3), number(.4)]) });
  const state = doc.cos.allocateObject(cosDict({ ca: number(.4), CA: number(.7), LW: number(3), LC: number(1), LJ: number(2), ML: number(5),
    BM: cosArray([doc.cos.allocateObject(cosName("Multiply"))]), D: cosArray([cosArray([number(2), number(3)]), number(1)]),
    Font: cosArray([cosDict({ Subtype: cosName("Type1"), BaseFont: cosName("Courier") }), number(13)]),
    ...(maskEnabled ? { SMask: doc.cos.allocateObject(mask) } : {}),
  }));
  const resources = cosDict({ ExtGState: cosDict({ GS: state, Clear: cosDict({ SMask: cosName("None") }) }) });
  const nodes = parseContentStream(new TextEncoder().encode("/GS gs 0 0 10 10 re B BT (A) Tj ET /Clear gs 20 20 5 5 re f"));
  const expected = [...evaluateContentStreamSteps({ pageIndex: 0, width: 100, height: 100, cosDoc: doc.cos, resourcesDict: resources, nodes })];
  const work = evaluateContentSteps({ pageIndex: 0, width: 100, height: 100, resourcesDict: resources });
  const cursors = new Map<object, Iterator<import("./parser.js").PdfContentEvent>>();
  const input = nodes[Symbol.iterator](), actual = [];
  let masks = 0, step = work.next();
  try {
    while (!step.done) {
      const request = step.value; await Promise.resolve();
      if (request.kind === "resolve" || request.kind === "catalog") step = work.next({ kind: "resolved", node: doc.cos.resolve(request.kind === "catalog" ? doc.cos.rootRef : request.node) });
      else if (request.kind === "font") step = work.next(resolvePageFonts(doc.cos, request.resources, request.name).get(request.name));
      else if (request.kind === "node") {
        let cursor = request.source ? cursors.get(request.source) : input;
        if (!cursor && request.source) { cursor = parseContentEvents(doc.cos.decodeStream(request.source.stream)); cursors.set(request.source, cursor); }
        const next = cursor!.next(); if (next.done && request.source) cursors.delete(request.source);
        step = work.next(next.done ? undefined : next.value);
      } else if (request.kind === "mask-parameters") {
        masks++; expect(request.mask).toBe(mask);
        step = work.next({ kind: "mask-parameters", value: { backdrop: { r: .2, g: .3, b: .4 }, transferMap: undefined } });
      } else if (request.kind === "paint") { actual.push(request); step = work.next(); }
      else throw new Error(`Unexpected request: ${request.kind}`);
    }
    expect(actual).toEqual(expected); expect(masks).toBe(maskEnabled ? 1 : 0);
    expect(actual.find(event => event.operation.kind === "glyph")?.operation).toMatchObject({ value: { fontName: "Courier", fontSize: 13 } });
    expect(actual.at(-1)?.operation.value.softMask).toBeUndefined();
  } finally { work.return(); for (const cursor of cursors.values()) cursor.return?.(); }
});

it("suspends named color conversion and preserves q/Q color scope", async () => {
  const { evaluateContentSteps } = await import("./evaluator.js");
  const { cosDict } = await import("../ast.js");
  const resources = cosDict();
  const nodes = parseContentStream(new TextEncoder().encode("q /Custom cs .25 scn 0 0 1 1 re f Q 2 0 1 1 re f"))[Symbol.iterator]();
  const work = evaluateContentSteps({ pageIndex: 0, width: 100, height: 100, resourcesDict: resources });
  const colors = []; let conversions = 0, step = work.next();
  while (!step.done) {
    const request = step.value;
    if (request.kind === "node") step = work.next(nodes.next().value);
    else if (request.kind === "color") {
      expect(request).toEqual({ kind: "color", name: "Custom", components: [.25], resources });
      conversions++; await Promise.resolve(); step = work.next({ kind: "color", value: [-1, .5, 2] });
    } else if (request.kind === "paint") {
      if (request.operation.kind === "path") colors.push(request.operation.value.fillColor);
      step = work.next();
    } else throw new Error(`Unexpected request: ${request.kind}`);
  }
  expect(conversions).toBe(1); expect(colors).toEqual([{ r: 0, g: .5, b: 1 }, { r: 0, g: 0, b: 0 }]);
});

it("suspends inline-image decoding while preserving stencil color and placement", async () => {
  const { evaluateContentSteps } = await import("./evaluator.js");
  const { cosDict, cosBool } = await import("../ast.js");
  const dict = cosDict({ IM: cosBool(true) }), data = new Uint8Array([128]);
  const work = evaluateContentSteps({ pageIndex: 0, width: 100, height: 100 });
  expect(work.next().value).toEqual({ kind: "node" });
  expect(work.next({ kind: "inline-image", dict, data }).value).toMatchObject({ kind: "inline-image", dict, data, fillColor: { r: 0, g: 0, b: 0, alpha: 1 } });
  const rgba = new Uint8Array([0, 0, 0, 255]); await Promise.resolve();
  expect(work.next({ kind: "decoded-image", image: { width: 1, height: 1, bitsPerComponent: 1, colorSpace: "gray", rgba } }).value).toMatchObject({ kind: "paint", operation: { kind: "image", value: { name: "InlineImage", decodedRgba: rgba } } });
  work.return();
});

it("evaluates tiling patterns through asynchronous metadata and fresh tile cursors", async () => {
  const { evaluateContentSteps } = await import("./evaluator.js");
  const { PdfDocument } = await import("../document.js");
  const { cosArray, cosDict, cosNumber, cosStream } = await import("../ast.js");
  const { parseContentEvents } = await import("./parser.js");
  const doc = PdfDocument.create();
  const nums = (values: number[]) => cosArray(values.map(value => doc.cos.allocateObject(cosNumber(value))));
  const pattern = doc.cos.allocateObject(cosStream(cosDict({ PatternType: cosNumber(1), PaintType: cosNumber(1), XStep: cosNumber(5), YStep: cosNumber(5),
    BBox: nums([0, 0, 5, 5]), Matrix: nums([1, 0, 0, 1, 0, 0]),
  }), new TextEncoder().encode("0 1 0 rg 0 0 3 3 re f")));
  const resources = cosDict({ Pattern: doc.cos.allocateObject(cosDict({ P: pattern })) });
  const nodes = parseContentStream(new TextEncoder().encode("/Pattern cs /P scn 0 0 10 10 re f"));
  const expected = [...evaluateContentStreamSteps({ pageIndex: 0, width: 100, height: 100, cosDoc: doc.cos, resourcesDict: resources, nodes })];
  const work = evaluateContentSteps({ pageIndex: 0, width: 100, height: 100, resourcesDict: resources });
  const cursors = new Map<object, Iterator<import("./parser.js").PdfContentEvent>>(), sources = new Set<object>();
  const input = nodes[Symbol.iterator](), actual = []; let step = work.next();
  try {
    while (!step.done) {
      const request = step.value; await Promise.resolve();
      if (request.kind === "resolve") step = work.next({ kind: "resolved", node: doc.cos.resolve(request.node) });
      else if (request.kind === "node") {
        let cursor = request.source ? cursors.get(request.source) : input;
        if (!cursor && request.source) { sources.add(request.source); cursor = parseContentEvents(doc.cos.decodeStream(request.source.stream)); cursors.set(request.source, cursor); }
        const next = cursor!.next(); if (next.done && request.source) cursors.delete(request.source);
        step = work.next(next.done ? undefined : next.value);
      } else if (request.kind === "paint") { actual.push(request); step = work.next(); }
      else throw new Error(`Unexpected request: ${request.kind}`);
    }
    expect(actual).toEqual(expected); expect(actual).toHaveLength(4); expect(sources.size).toBe(4); expect(cursors.size).toBe(0);
  } finally { work.return(); for (const cursor of cursors.values()) cursor.return?.(); }
});

it.each([false, true])("requests shading rendering with correct page or pattern bounds: %s", async pattern => {
  const { evaluateContentSteps } = await import("./evaluator.js");
  const { cosArray, cosDict, cosNumber } = await import("../ast.js");
  const dict = cosDict();
  const resources = cosDict({ Shading: cosDict({ S: dict }), Pattern: cosDict({ P: cosDict({ PatternType: cosNumber(2), Shading: dict,
    Matrix: cosArray([1, 0, 0, 1, 3, 4].map(n => cosNumber(n))),
  }) }) });
  const nodes = parseContentStream(new TextEncoder().encode(pattern ? "/Pattern cs /P scn 10 20 10 10 re f" : "/S sh"))[Symbol.iterator]();
  const work = evaluateContentSteps({ pageIndex: 0, width: 100, height: 80, origin: [10, 20], resourcesDict: resources });
  let rendered = 0, painted = 0, step = work.next();
  while (!step.done) {
    const request = step.value;
    if (request.kind === "node") step = work.next(nodes.next().value);
    else if (request.kind === "resolve") step = work.next({ kind: "resolved", node: request.node });
    else if (request.kind === "shading") {
      expect(request.dict).toBe(dict); expect(request.bounds).toEqual(pattern ? [10, 20, 20, 30] : [10, 20, 110, 100]);
      expect(request.matrix).toEqual(pattern ? [1, 0, 0, 1, 3, 4] : [1, 0, 0, 1, 0, 0]);
      rendered++; await Promise.resolve();
      step = work.next({ kind: "shading", image: { name: request.name, matrix: [10, 0, 0, 10, 10, 20], width: 1, height: 1, colorSpace: "rgb", bitsPerComponent: 8, decodedRgba: new Uint8Array([0, 255, 0, 255]) } });
    } else if (request.kind === "paint") { expect(request.operation.kind).toBe("image"); painted++; step = work.next(); }
    else throw new Error(`Unexpected request: ${request.kind}`);
  }
  expect(rendered).toBe(1); expect(painted).toBe(1);
});
