import type { PdfDisplayList, PdfExtractedTable, PdfPlacedGlyph } from "../ast.js";

export function extractTablesFromDisplayList(displayList: PdfDisplayList): PdfExtractedTable[] {
  const glyphs = displayList.glyphs.filter(g => g.unicode.trim().length > 0);
  if (glyphs.length === 0) return [];

  // Group glyphs by baseline row
  const sorted = [...glyphs].sort((a, b) => {
    const dy = b.baselineY - a.baselineY;
    if (Math.abs(dy) > 4) return dy;
    return a.bbox[0] - b.bbox[0];
  });

  const rowGroups: PdfPlacedGlyph[][] = [];
  for (const g of sorted) {
    const last = rowGroups[rowGroups.length - 1];
    if (last && Math.abs(last[0]!.baselineY - g.baselineY) <= 4) {
      last.push(g);
    } else {
      rowGroups.push([g]);
    }
  }

  // Split each row into cell clusters separated by horizontal gaps (> 16pt)
  const segmentedRows: Array<{
    baselineY: number;
    bbox: [number, number, number, number];
    cells: Array<{ text: string; x0: number; x1: number }>;
  }> = [];

  for (const rGroup of rowGroups) {
    rGroup.sort((a, b) => a.bbox[0] - b.bbox[0]);
    const cells: Array<{ text: string; x0: number; x1: number }> = [];
    let curCell: PdfPlacedGlyph[] = [];
    const flushCell = () => {
      if (curCell.length === 0) return;
      let text = "";
      for (let i = 0; i < curCell.length; i++) {
        if (i > 0) {
          const gap = curCell[i]!.bbox[0] - curCell[i - 1]!.bbox[2];
          if (gap > curCell[i]!.fontSize * 0.22 && !text.endsWith(" ")) {
            text += " ";
          }
        }
        text += curCell[i]!.unicode;
      }
      cells.push({
        text: text.trim(),
        x0: curCell[0]!.bbox[0],
        x1: curCell[curCell.length - 1]!.bbox[2],
      });
      curCell = [];
    };

    for (const g of rGroup) {
      if (curCell.length > 0) {
        const prev = curCell[curCell.length - 1]!;
        if (g.bbox[0] - prev.bbox[2] > 16) {
          flushCell();
        }
      }
      curCell.push(g);
    }
    flushCell();

    if (cells.length >= 2) {
      const x0 = Math.min(...rGroup.map(g => g.bbox[0]));
      const y0 = Math.min(...rGroup.map(g => g.bbox[1]));
      const x1 = Math.max(...rGroup.map(g => g.bbox[2]));
      const y1 = Math.max(...rGroup.map(g => g.bbox[3]));
      segmentedRows.push({
        baselineY: rGroup[0]!.baselineY,
        bbox: [x0, y0, x1, y1],
        cells,
      });
    }
  }

  if (segmentedRows.length < 2) return [];

  // Cluster consecutive multi-cell rows into tables
  const tables: PdfExtractedTable[] = [];
  let currentCluster = [segmentedRows[0]!];

  const flushCluster = () => {
    if (currentCluster.length < 2) return;
    const colAnchors: number[] = [];
    for (const row of currentCluster) {
      for (const cell of row.cells) {
        if (!colAnchors.some(a => Math.abs(a - cell.x0) <= 24)) {
          colAnchors.push(cell.x0);
        }
      }
    }
    colAnchors.sort((a, b) => a - b);
    if (colAnchors.length < 2) return;

    const matrix: string[][] = currentCluster.map(row => {
      const outRow = new Array<string>(colAnchors.length).fill("");
      for (const cell of row.cells) {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < colAnchors.length; i++) {
          const dist = Math.abs(colAnchors[i]! - cell.x0);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        outRow[bestIdx] = outRow[bestIdx] ? `${outRow[bestIdx]} ${cell.text}` : cell.text;
      }
      return outRow;
    });

    const bbox: [number, number, number, number] = [
      Math.min(...currentCluster.map(r => r.bbox[0])),
      Math.min(...currentCluster.map(r => r.bbox[1])),
      Math.max(...currentCluster.map(r => r.bbox[2])),
      Math.max(...currentCluster.map(r => r.bbox[3])),
    ];
    tables.push({
      pageIndex: displayList.pageIndex,
      bbox,
      headers: matrix[0] ?? [],
      rows: matrix.slice(1),
    });
  };

  for (let i = 1; i < segmentedRows.length; i++) {
    const prev = segmentedRows[i - 1]!;
    const cur = segmentedRows[i]!;
    if (prev.baselineY - cur.baselineY <= 42) {
      currentCluster.push(cur);
    } else {
      flushCluster();
      currentCluster = [cur];
    }
  }
  flushCluster();

  return tables;
}
