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

it("closes input when initial resource resolution fails", async () => {
  const { PdfDocument } = await import("../document.js");
  const doc = PdfDocument.create(); const failure = new Error("resource read failed");
  doc.cos.resolve = () => { throw failure; };
  let closed = false;
  const nodes: Iterable<PdfContentNode> = { [Symbol.iterator]() { return {
    next() { return { done: true, value: undefined }; },
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
