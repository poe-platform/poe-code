import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPdfLayout } from "./layout.js";
import { parsePdfObjects, PdfSyntaxError } from "./syntax.js";
const bytes = (s: string) => new TextEncoder().encode(s);
const object = (s: string) => parsePdfObjects(bytes(s))[0]!;
const resources = object("<< /Font << /F 1 0 R >> >>");
const font = object("<< /Subtype /Type1 /Encoding /WinAnsiEncoding /FirstChar 32 /Widths [500] /MissingWidth 500 /FontDescriptor << /MissingWidth 500 >> >>");
const extract = (s: string, mode: "logical" | "layout" | "content" = "layout", rotate = 0) => extractPdfLayout(bytes(s), resources, { lookup: () => font, mode, rotate, box: [0, 0, 200, 100] });
test("layout sorts independent positioned strings while content mode retains stream order", () => {
  const s = "BT /F 10 Tf 1 0 0 1 80 70 Tm (B) Tj 1 0 0 1 20 70 Tm (A) Tj 1 0 0 1 20 40 Tm (C) Tj ET";
  assert.equal(extract(s, "content").text, "BAC");
  assert.equal(extract(s).text, "A B\nC");
  assert.deepEqual(extract(s).runs.map(r => r.glyphStart), [1, 0, 2]);
  assert.deepEqual(extract(s).glyphs[0]!.origin, [80, 70]);
});
test("logical replacements and raw content projection remain distinct", () => {
  const s = "BT /F 10 Tf /Span << /ActualText (replacement) >> BDC (A) Tj EMC ET";
  assert.equal(extract(s, "logical").text, "replacement");
  assert.equal(extract(s, "content").text, "A");
  assert.equal(extract(s).text, "A");
});
test("page rotation gives display coordinates without changing original geometry", () => {
  for (const [angle, origin, size] of [[0, [20, 30], [200, 100]], [90, [70, 20], [100, 200]], [180, [180, 70], [200, 100]], [270, [30, 180], [100, 200]]] as const) {
    const r = extract("BT /F 10 Tf 1 0 0 1 20 70 Tm (A) Tj ET", "layout", angle);
    assert.deepEqual(r.runs[0]!.origin, origin);
    assert.deepEqual(r.size, size);
    assert.deepEqual(r.glyphs[0]!.origin, [20, 70]);
  }
});
test("empty image-only content has no extractable text", () => {
  assert.equal(extract("").text, "");
  assert.deepEqual(extract("").runs, []);
});
test("layout policy and resource limits are fatal and cancellation preserves identity", () => {
  assert.throws(() => extract("", "layout", 45), (e) => e instanceof PdfSyntaxError && e.code === "ARGUMENT");
  assert.throws(() => extractPdfLayout(bytes(""), undefined, { limits: { work: 0 } }), (e) => e instanceof PdfSyntaxError && e.code === "LIMIT");
  const controller = new AbortController(); const reason = {}; controller.abort(reason);
  assert.throws(() => extractPdfLayout(bytes(""), undefined, { signal: controller.signal }), e => e === reason);
});
test("columns and tables use explicit row order rather than inferred column reading order", () => {
  const s = "BT /F 10 Tf 1 0 0 1 100 40 Tm (D) Tj 1 0 0 1 20 70 Tm (A) Tj 1 0 0 1 100 70 Tm (B) Tj 1 0 0 1 20 40 Tm (C) Tj ET";
  assert.equal(extract(s).text, "A B\nC D");
  assert.equal(extract(s, "logical").text, "DABC");
  assert.equal(extract(s).ordering, "display-row-bands");
});
test("literal whitespace and separate adjacent strings are preserved without invented gaps", () => {
  const s = "BT /F 10 Tf 1 0 0 1 20 70 Tm (A B) Tj (C) Tj ET";
  assert.equal(extract(s).text, "A BC");
  assert.equal(extract(s).runs.length, 2);
});
test("RTL Unicode and ligatures retain code provenance; normalization is explicit", () => {
  const f = object("<< /Subtype /Type1 /FirstChar 1 /Widths [500 500 500] /ToUnicode 2 0 R >>");
  const options = { lookup: () => f, stream: () => bytes("3 beginbfchar <01> <05d0> <02> <05d1> <03> <fb01> endbfchar"), box: [0, 0, 200, 100] as [number, number, number, number] };
  const input = bytes("BT /F 10 Tf -1 0 0 1 80 70 Tm <010203> Tj ET");
  const r = extractPdfLayout(input, resources, options);
  assert.equal(r.text, "אבﬁ");
  assert.deepEqual(r.runs[0]!.direction, [-1, 0]);
  assert.deepEqual(r.glyphs.map(g => Array.from(g.codeBytes)), [[1], [2], [3]]);
  assert.equal(extractPdfLayout(input, resources, { ...options, mode: "layout", normalization: "NFKC" }).text, "אבfi");
  assert.equal(r.glyphs[2]!.unicode, "ﬁ");
});
test("vertical writing retains downward advances and rotated direction", () => {
  const f = object("<< /Subtype /Type0 /Encoding /Identity-V /DescendantFonts [<< /Subtype /CIDFontType2 /DW 1000 /DW2 [880 -1000] >>] /ToUnicode 2 0 R >>");
  const options = { lookup: () => f, stream: () => bytes("1 beginbfchar <0001> <0041> endbfchar"), box: [0, 0, 200, 100] as [number, number, number, number] };
  const input = bytes("BT /F 10 Tf 1 0 0 1 20 70 Tm <00010001> Tj ET");
  assert.deepEqual(extractPdfLayout(input, resources, options).runs[0]!.direction, [0, 1]);
  assert.deepEqual(extractPdfLayout(input, resources, { ...options, rotate: 90 }).runs[0]!.direction, [-1, 0]);
});
test("missing metrics remain unknown and layout quotas apply to run staging", () => {
  const f = object("<< /Subtype /Type1 /Encoding /WinAnsiEncoding >>");
  const r = extractPdfLayout(bytes("BT /F 10 Tf (AB) Tj ET"), resources, { lookup: () => f, mode: "layout" });
  assert.equal(r.geometryComplete, false);
  assert.equal(r.runs[0]!.end, undefined);
  assert.ok(r.diagnostics.some(d => d.code === "UNKNOWN_WIDTH"));
  assert.throws(() => extractPdfLayout(bytes("BT /F 10 Tf (A) Tj ET"), resources, { lookup: () => font, maxRuns: 0 }), (e) => e instanceof PdfSyntaxError && e.code === "LIMIT");
});
test("fixed row bands and ties are deterministic with configurable tolerance", () => {
  const input = bytes("BT /F 10 Tf 1 0 0 1 20 70 Tm (A) Tj 1 0 0 1 20 70 Tm (B) Tj 1 0 0 1 80 69 Tm (C) Tj ET");
  assert.equal(extractPdfLayout(input, resources, { lookup: () => font, mode: "layout", box: [0, 0, 200, 100] }).text, "AB C");
  assert.equal(extractPdfLayout(input, resources, { lookup: () => font, mode: "layout", box: [0, 0, 200, 100], lineTolerance: 1 }).text, "AB\nC");
});
test("layout rejects unsafe display arithmetic and invalid policies", () => {
  for (const options of [{ lineTolerance: 0 }, { lineTolerance: NaN }, { maxRuns: -1 }, { box: [0, 0, 0, 1] }, { box: [-1e308, 0, 1e308, 1] }, { mode: "guessed" }]) {
    assert.throws(() => extractPdfLayout(bytes(""), undefined, options as never), e => e instanceof PdfSyntaxError && e.code === "ARGUMENT");
  }
  assert.throws(() => extractPdfLayout(bytes("BT /F 10 Tf 1 0 0 1 0 1 Tm (A) Tj ET"), resources, { lookup: () => font, mode: "layout", lineTolerance: Number.MIN_VALUE }), e => e instanceof PdfSyntaxError && e.code === "ARGUMENT");
});
