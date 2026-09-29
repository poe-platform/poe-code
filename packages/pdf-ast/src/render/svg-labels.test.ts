import { expect, it } from "vitest";
import { SaxesParser } from "saxes";
import { PdfDocument, renderDisplayListToSvg } from "../index.js";

function renderLabel(label: string) {
  const doc = PdfDocument.create(), page = doc.addPage([100, 100]);
  page.drawText("A", { x: 10, y: 30, size: 20 });
  const display = page.evaluateDisplayList();
  return renderDisplayListToSvg({ ...display, operations: undefined, glyphs: display.glyphs.map(glyph => ({ ...glyph, unicode: label })) });
}

it.each(["\u0000", "\u0001", "\u000b", "\u000c", "\u001e", "\ud800", "\udfff", "\ufffe", "\uffff"])("exports well-formed XML when a glyph label contains forbidden character %j", invalid => {
  const svg = renderLabel(`before${invalid}after`);
  const parser = new SaxesParser();
  const labels: string[] = [];
  parser.on("opentag", node => { if (node.name === "path") labels.push(node.attributes["aria-label"] as string); });
  expect(() => parser.write(svg).close()).not.toThrow();
  expect(labels).toEqual(["beforeafter"]);
  expect(svg).toContain('<path');
});

// Adapted from PDF.js core_utils_spec.js encodeToXmlString's valid text cases.
it.each([
  ['"\u0397ell😂\' & <W😂rld>', '&quot;&#x397;ell&#x1F602;&apos; &amp; &lt;W&#x1F602;rld&gt;'],
  ['hello world', 'hello world'],
])("uses PDF.js XML escaping for valid labels: %s", (text, escaped) => {
  const svg = renderLabel(text);
  expect(svg).toContain(`aria-label="${escaped}"`);
  const parser = new SaxesParser();
  parser.on("opentag", node => { if (node.name === "path") expect(node.attributes["aria-label"]).toBe(text); });
  parser.write(svg).close();
});

it("preserves XML whitespace and supplementary characters in accessible labels", () => {
  const label = "a\t\n\r\u0085\uD83D\uDE00z";
  const parser = new SaxesParser();
  parser.on("opentag", node => { if (node.name === "path") expect(node.attributes["aria-label"]).toBe(label); });
  parser.write(renderLabel(label)).close();
});
