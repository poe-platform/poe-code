import type { PdfDisplayList, PdfExtractedPage, PdfExtractedTable, PdfSemanticNode } from "../ast.js";

function parseOrderedListPrefix(text: string): string | undefined {
  let pos = 0;
  while (pos < text.length) {
    const c = text.charCodeAt(pos);
    if (c >= 0x30 && c <= 0x39) {
      pos++;
    } else {
      break;
    }
  }
  if (pos === 0 || pos >= text.length) return undefined;
  const sep = text[pos];
  if ((sep === "." || sep === ")") && text[pos + 1] === " ") {
    return text.slice(pos + 2).trimStart();
  }
  return undefined;
}

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
      } else if (block.kind === "list-item" || parseOrderedListPrefix(text) !== undefined) {
        for (const line of block.lines) {
          const lineText = line.text.trim();
          if (!lineText) continue;
          const orderedBody = parseOrderedListPrefix(lineText);
          const isBullet =
            lineText.startsWith("•") || lineText.startsWith("-") || lineText.startsWith("*");
          const isOrdered = orderedBody !== undefined;
          const last = nodes[nodes.length - 1];
          if (orderedBody !== undefined) {
            if (last?.kind === "list" && last.ordered) {
              last.items.push(orderedBody);
            } else {
              nodes.push({ kind: "list", ordered: true, items: [orderedBody] });
            }
          } else if (isBullet) {
            const cleaned = lineText.slice(1).trimStart();
            if (last?.kind === "list" && !last.ordered) {
              last.items.push(cleaned);
            } else {
              nodes.push({ kind: "list", ordered: false, items: [cleaned] });
            }
          } else if (last?.kind === "list" && last.items.length > 0) {
            last.items[last.items.length - 1] += ` ${lineText}`;
          } else {
            nodes.push({ kind: "list", ordered: false, items: [lineText] });
          }
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
