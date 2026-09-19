import { drawingShapeSourceCases, drawingShapeSourceXml } from "./drawing-shape-exact-source.js";
export function inlineShapeExtentCarrierXml(strict: boolean, carrier: "direct" | "choice" | "fallback" | "process", placement: "paragraph" | "drawing" | "leaf", alternative = false): string {
  const original = drawingShapeSourceXml(drawingShapeSourceCases.find(c => c.row === 987)!, strict).paragraph;
  const shadow = alternative ? '<wp:inline><wp:extent cx="99" cy="101"/></wp:inline>' : '';
  const wrap = (value: string) => carrier === "direct" ? value : carrier === "process" ? `<f:pass>${value}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? value : shadow}</mc:Choice><mc:Fallback>${carrier === "fallback" ? value : shadow}</mc:Fallback></mc:AlternateContent>`;
  let paragraph = original.replace('<w:p ', '<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:shape-extents" mc:Ignorable="f" mc:ProcessContent="f:pass" ');
  if (placement === "paragraph") { const start = paragraph.indexOf('>') + 1, end = paragraph.lastIndexOf('</w:p>'); return paragraph.slice(0, start) + wrap(paragraph.slice(start, end)) + paragraph.slice(end); }
  if (placement === "drawing") { const start = paragraph.indexOf('<wp:inline>'), end = paragraph.indexOf('</wp:inline>') + '</wp:inline>'.length; return paragraph.slice(0, start) + wrap(paragraph.slice(start, end)) + paragraph.slice(end); }
  const extent = '<wp:extent cx="333" cy="666"/>'; paragraph = paragraph.replace(extent, wrap(extent));
  const start = paragraph.indexOf('<a:graphic>'), end = paragraph.indexOf('</a:graphic>') + '</a:graphic>'.length;
  return paragraph.slice(0, start) + wrap(paragraph.slice(start, end)) + paragraph.slice(end);
}
