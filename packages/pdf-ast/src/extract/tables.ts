import type { PdfDisplayList, PdfExtractedTable, PdfPlacedGlyph } from "../ast.js";

interface VerticalRule {
  readonly x: number;
  readonly yMin: number;
  readonly yMax: number;
}

function collectVerticalRules(displayList: PdfDisplayList): VerticalRule[] {
  const rules: VerticalRule[] = [];
  for (const path of displayList.paths) {
    if (!path.strokeColor && !path.fillColor) continue;
    let curX = 0;
    let curY = 0;
    let startX = 0;
    let startY = 0;
    for (const seg of path.segments) {
      if (seg.kind === "move") {
        curX = seg.x;
        curY = seg.y;
        startX = seg.x;
        startY = seg.y;
      } else if (seg.kind === "line") {
        if (Math.abs(seg.x - curX) <= 3 && Math.abs(seg.y - curY) >= 10) {
          rules.push({
            x: (curX + seg.x) / 2,
            yMin: Math.min(curY, seg.y),
            yMax: Math.max(curY, seg.y),
          });
        }
        curX = seg.x;
        curY = seg.y;
      } else if (seg.kind === "close") {
        if (Math.abs(startX - curX) <= 3 && Math.abs(startY - curY) >= 10) {
          rules.push({
            x: (curX + startX) / 2,
            yMin: Math.min(curY, startY),
            yMax: Math.max(curY, startY),
          });
        }
        curX = startX;
        curY = startY;
      } else if (seg.kind === "rect") {
        const yMin = Math.min(seg.y, seg.y + seg.height);
        const yMax = Math.max(seg.y, seg.y + seg.height);
        if (yMax - yMin >= 10) {
          if (Math.abs(seg.width) <= 3) {
            // Thin filled vertical rule
            rules.push({ x: seg.x + seg.width / 2, yMin, yMax });
          } else {
            // Stroked cell box left & right edges
            rules.push({ x: seg.x, yMin, yMax });
            rules.push({ x: seg.x + seg.width, yMin, yMax });
          }
        }
      }
    }
  }
  return rules;
}

export function extractTablesFromDisplayList(displayList: PdfDisplayList): PdfExtractedTable[] {
  const glyphs = displayList.glyphs.filter(g => g.unicode.trim().length > 0);
  if (glyphs.length === 0) return [];
  const verticalRules = collectVerticalRules(displayList);

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
        const crossedVerticalRule = verticalRules.some(
          r =>
            r.x >= prev.bbox[2] - 2 &&
            r.x <= g.bbox[0] + 2 &&
            r.yMin - 4 <= g.baselineY &&
            g.baselineY <= r.yMax + 4
        );
        if (g.bbox[0] - prev.bbox[2] > 16 || crossedVerticalRule) {
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
        const hasMatchingAnchor = colAnchors.some(a => {
          if (Math.abs(a - cell.x0) > 24) return false;
          const minX = Math.min(a, cell.x0);
          const maxX = Math.max(a, cell.x0);
          const separatedByRule = verticalRules.some(
            r => r.x > minX + 1 && r.x < maxX - 1
          );
          return !separatedByRule;
        });
        if (!hasMatchingAnchor) {
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
