import {expect, it} from "vitest";
import {PDFDocument, PDFArray, PDFDict, PDFName, PDFRawStream, decodePDFRawStream} from "pdf-lib";
import {convert} from "./engine.js";

it("exports Latin Extended text, baselines, highlights and internal links without dropping formatting", async () => {
  const html = '<h1 id="heading">Heading</h1><p>Zażółć gęślą jaźń. Water H<sub>2</sub>O and x<sup>2</sup>. <mark>Highlight</mark> <a href="#heading">Return</a>.</p><pre><code>let x = 2;</code></pre>';
  const result = await convert([{bytes:new TextEncoder().encode(html)}], {from:"html",to:"pdf"}, {yield:async()=>{}});
  if(result.kind!=="binary") throw Error("Expected PDF");
  expect(result.diagnostics).toEqual([]);
  const pdf=await PDFDocument.load(result.bytes), page=pdf.getPages()[0]!;
  const contents=page.node.Contents() as PDFArray;
  const operators=Array.from({length:contents.size()},(_,i)=>new TextDecoder().decode(decodePDFRawStream(contents.lookup(i,PDFRawStream)).decode())).join("\n");
  expect(operators).toContain(" rg");
  expect(operators).toContain("1 0.9529411764705882 0.6392156862745098 rg");
  expect(operators).toContain("h\nf");
  expect(page.node.Annots()!.size()).toBeGreaterThan(0);
  const annotations=page.node.Annots()!;
  const link=annotations.lookup(0,PDFDict);
  expect(link.has(PDFName.of("Dest"))).toBe(true);
  expect(link.has(PDFName.of("A"))).toBe(false);
});
