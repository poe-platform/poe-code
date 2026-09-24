import type { PdfDisplayList, PdfExtractedPage, PdfExtractedTable, PdfSemanticNode } from "../ast.js";

export function buildSemanticAstFromPages(
  pages: readonly PdfExtractedPage[],
  tablesByPage: ReadonlyMap<number, readonly PdfExtractedTable[]>,
  displayLists: readonly PdfDisplayList[]
): PdfSemanticNode[] {
  const nodes: PdfSemanticNode[] = [];

  for (const page of pages) {
    const pageTables = tablesByPage.get(page.pageIndex) ?? [];
    const dl = displayLists.find(d => d.pageIndex === page.pageIndex);

    for (const block of page.blocks) {
      // Skip blocks that fall inside an extracted table's bounding box
      const inTable = pageTables.some(
        t =>
          block.bbox[0] >= t.bbox[0] - 8 &&
          block.bbox[2] <= t.bbox[2] + 8 &&
          block.bbox[1] >= t.bbox[1] - 8 &&
          block.bbox[3] <= t.bbox[3] + 8
      );
      if (inTable) continue;

      const text = block.lines.map(l => l.text).join(" ").trim();
      if (!text) continue;

      if (block.kind === "heading") {
        const fontSize = block.lines[0]?.words[0]?.glyphs[0]?.fontSize ?? 16;
        const level: 1 | 2 | 3 | 4 | 5 | 6 = fontSize >= 22 ? 1 : fontSize >= 18 ? 2 : 3;
        nodes.push({ kind: "heading", level, text });
      } else if (block.kind === "list-item") {
        const cleaned = text.replace(/^[•\-*]\s*/, "");
        const last = nodes[nodes.length - 1];
        if (last?.kind === "list") {
          last.items.push(cleaned);
        } else {
          nodes.push({ kind: "list", ordered: false, items: [cleaned] });
        }
      } else {
        nodes.push({ kind: "paragraph", text });
      }
    }

    for (const tbl of pageTables) {
      nodes.push({
        kind: "table",
        headers: tbl.headers,
        rows: tbl.rows,
      });
    }

    if (dl) {
      for (const annot of dl.annotations) {
        if (annot.uri) {
          nodes.push({
            kind: "link",
            text: annot.contents ?? annot.uri,
            uri: annot.uri,
          });
        }
      }
      for (const img of dl.images) {
        nodes.push({
          kind: "image",
          pageIndex: page.pageIndex,
          width: img.width,
          height: img.height,
        });
      }
    }
  }

  return nodes;
}
