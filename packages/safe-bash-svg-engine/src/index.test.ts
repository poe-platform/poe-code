import { expect, test } from "vitest";
import { PdfDocument, decodePng } from "@poe-code/pdf-ast";
import { renderSvgDocument } from "./index.js";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="48"><rect width="96" height="48" fill="red"/><text x="5" y="24">Vector</text></svg>';
test("preserves vectors and text in PDF and renders PNG dimensions", async () => {
  const bytes = await renderSvgDocument(svg, "pdf");
  const page = PdfDocument.load(bytes).getPage(0);
  expect(page.getSize()).toEqual({ width: 72, height: 36 });
  expect(page.extractPage().blocks.flatMap(block => block.lines).map(line => line.text).join(" ")).toContain("Vector");
  const png = decodePng(await renderSvgDocument(svg, "png"));
  expect([png.width, png.height]).toEqual([96, 48]);
  expect(Array.from(png.data.slice(0, 3))).toEqual([255, 0, 0]);
});

test("preserves dashed strokes", async () => {
  const page = PdfDocument.load(await renderSvgDocument('<svg width="40" height="10"><path d="M0 5H40" fill="none" stroke="black" stroke-dasharray="3 2"/></svg>', "pdf")).getPage(0);
  expect(JSON.stringify(page.evaluateDisplayList())).toContain('"dashArray":[3,2]');
});

test.each([
  '<svg><text><tspan>missing</tspan></text></svg>',
  '<svg><rect width="10" height="10" opacity="0.5"/></svg>',
  '<svg><rect width="10" height="10" clip-path="url(#clip)"/></svg>',
  '<svg><path d="L1 2"/></svg>',
  '<svg><rect width="-1" height="2"/></svg>',
])("rejects invalid or unsupported visible content: %s", async source => {
  await expect(renderSvgDocument(source, "pdf")).rejects.toThrow();
});

test("enforces pixel, node and cancellation bounds", async () => {
  await expect(renderSvgDocument('<svg width="100" height="100"/>', "png", { maxPixels: 99 })).rejects.toThrow();
  await expect(renderSvgDocument('<svg><g/><g/></svg>', "pdf", { maxNodes: 1 })).rejects.toThrow();
  await expect(renderSvgDocument('<svg/>', "pdf", { signal: AbortSignal.abort() })).rejects.toThrow();
});

test("does not paint text with fill none", async () => {
  const page = PdfDocument.load(await renderSvgDocument('<svg><text fill="none">Hidden</text></svg>', "pdf")).getPage(0);
  expect(page.extractPage().blocks).toEqual([]);
});

test("renders Graphviz point dimensions, transforms, paths and centered labels", async () => {
  const source = '<svg width="72pt" height="72pt" viewBox="0 0 72 72"><g transform="scale(1 1) rotate(0) translate(4 68)"><title>graph</title><polygon fill="white" points="-4,4 -4,-68 68,-68 68,4"/><ellipse fill="none" stroke="black" cx="32" cy="-32" rx="27" ry="18"/><path fill="none" stroke="black" d="M 5 -32 C 12 -50 52 -50 59 -32"/><text text-anchor="middle" x="32" y="-28" font-size="14">Hello</text></g></svg>';
  const page = PdfDocument.load(await renderSvgDocument(source, "pdf")).getPage(0);
  expect(page.getSize()).toEqual({ width: 72, height: 72 });
  expect(page.extractPage().blocks.flatMap(block => block.lines).map(line => line.text).join(" ")).toContain("Hello");
  const list = page.evaluateDisplayList();
  expect(list.paths.length).toBe(3);
  const first = list.paths[0]!.segments[0]!;
  expect(first.kind).toBe("move");
  if (first.kind === "move") { expect(first.x).toBeCloseTo(0, 4); expect(first.y).toBeCloseTo(0, 4); }
});

test("rounded rectangles preserve curved corners", async () => {
  const page = PdfDocument.load(await renderSvgDocument('<svg><rect x="10" y="10" width="60" height="40" rx="8"/></svg>', "pdf")).getPage(0);
  expect(page.evaluateDisplayList().paths[0]!.segments.filter(segment => segment.kind === "cubic")).toHaveLength(4);
});

test.each([
  ["lightblue", [173, 216, 230]],
  ["lightgrey", [211, 211, 211]],
  ["RebeccaPurple", [102, 51, 153]],
  ["papayawhip", [255, 239, 213]],
])("renders CSS named color %s", async (fill, rgb) => {
  const png = decodePng(await renderSvgDocument(`<svg width="2" height="2"><rect width="2" height="2" fill="${fill}"/></svg>`, "png"));
  expect(Array.from(png.data.slice(0, 3))).toEqual(rgb);
});
