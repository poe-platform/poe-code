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
