import type {CellPrintBorder} from "./cell-style.js";
import {printBorderStrokes} from "./diagonal-borders.js";

type Border = Pick<CellPrintBorder, "style" | "color" | "alpha">;
type Borders = readonly (Border | undefined)[];
interface BorderRow {
  readonly top: Borders;
  readonly bottom: Borders;
  readonly vertical: Borders;
  readonly previous: Borders;
  readonly widths: readonly number[];
  readonly y: number;
  readonly height: number;
  readonly last?: boolean;
}
const begin = (border: Border | undefined) => !border ? 0 : border.style === 6 || printBorderStrokes[border.style]!.width > 1 ? 1 : 0;
const end = (border: Border | undefined) => !border ? 0 : border.style === 6 || printBorderStrokes[border.style]!.width > 2 ? 1 : 0;

/** Gnumeric style-border.c print junctions, after shared-edge ownership resolution. */
export function printBorderRow(row: BorderRow, tick: () => void) {
  const lines: {border: Border; x1: number; y1: number; x2: number; y2: number}[] = [];
  let x = 0;
  for (let col = 0; col <= row.widths.length; col++) {
    tick();
    const fence = col === row.widths.length;
    if (!fence && row.widths[col] === 0) continue;
    const next = x + (row.widths[col] ?? 0), top = row.top[col];
    if (!fence && top) {
      const t0 = row.previous[col], t1 = row.previous[col + 1], b0 = row.vertical[col], b1 = row.vertical[col + 1];
      const odd = printBorderStrokes[top.style]!.width % 2 ? 0.5 : 0;
      if (top.style === 6) {
        const outerStart = t0 ? t0.style === 6 ? end(t0) : -begin(t0) : -begin(b0);
        const outerEnd = t1 ? t1.style === 6 ? -begin(t1) : end(t1) : end(b1);
        const innerStart = b0 ? b0.style === 6 ? end(b0) : -begin(b0) : -begin(t0);
        const innerEnd = b1 ? b1.style === 6 ? -begin(b1) : end(b1) : end(t1);
        lines.push({border: top, x1: x + outerStart, y1: row.y - 1 + odd, x2: next + outerEnd + 1, y2: row.y - 1 + odd},
          {border: top, x1: x + innerStart, y1: row.y + 1 + odd, x2: next + innerEnd + 1, y2: row.y + 1 + odd});
      } else {
        const left = row.top[col - 1] ? 0 : -Math.max(begin(t0), begin(b0));
        const right = row.top[col + 1] ? 0 : Math.max(end(t1), end(b1));
        lines.push({border: top, x1: x + left, y1: row.y + odd, x2: next + right + 1, y2: row.y + odd});
      }
    }
    const border = row.vertical[col];
    if (!row.last && border) {
      const l0 = row.top[col - 1], r0 = row.top[col], l1 = row.bottom[col - 1], r1 = row.bottom[col];
      const odd = printBorderStrokes[border.style]!.width % 2 ? 0.5 : 0;
      if (border.style === 6) {
        const leftStart = l0 ? end(l0) : -begin(r0), leftEnd = l1 ? -begin(l1) : end(r1);
        const rightStart = r0 ? end(r0) : -begin(l0), rightEnd = r1 ? -begin(r1) : end(l1);
        lines.push({border, x1: x - 1 + odd, y1: row.y + leftStart + (fence ? 1 : 0),
          x2: x - 1 + odd, y2: row.y + row.height + leftEnd + (fence ? 0 : 1)},
        {border, x1: x + 1 + odd, y1: row.y + rightStart, x2: x + 1 + odd, y2: row.y + row.height + rightEnd + 1});
      } else {
        const start = Math.max(l0 ? 1 + end(l0) : 0, r0 ? 1 + end(r0) : 0);
        const finish = Math.max(l1 ? 1 + begin(l1) : 0, r1 ? 1 + begin(r1) : 0);
        lines.push({border, x1: x + odd, y1: row.y + start, x2: x + odd, y2: row.y + row.height - finish + 1});
      }
    }
    x = next;
  }
  return lines;
}
