import type {CellPrintBorder} from "./cell-style.js";

// Gnumeric style-border.c uses unscaled point widths and dash lengths for print.
export const printBorderStrokes = [
  {width: 0}, {width: 1}, {width: 2}, {width: 1, dash: [3, 1]},
  {width: 1, dash: [2, 2]}, {width: 3}, {width: 1}, {width: 1, dash: [1, 1]},
  {width: 2, dash: [9, 3], phase: 9}, {width: 1, dash: [8, 3, 3, 3]},
  {width: 2, dash: [9, 3, 3, 3], phase: 17}, {width: 1, dash: [3, 3, 9, 3, 3, 3]},
  {width: 2, dash: [3, 3, 3, 3, 9, 3], phase: 21}, {width: 2, dash: [11, 1, 5, 1], phase: 6}
] as const;

export function printDiagonalBorders(borders: readonly CellPrintBorder[], width: number, height: number, tick: () => void) {
  return [...borders].sort((a, b) => a.side === b.side ? 0 : a.side === "Rev-Diagonal" ? -1 : 1).flatMap(border => {
    tick();
    const stroke = printBorderStrokes[border.style]!;
    const reverse = border.side === "Rev-Diagonal";
    const lines = border.style === 6 ? reverse ?
      [[1.5, 3, width - 2, height - 0.5], [3, 1.5, width - 0.5, height - 2]] :
      [[1.5, height - 2, width - 2, 1.5], [3, height - 0.5, width - 0.5, 3]] :
      [reverse ? [0.5, 0.5, width + 0.5, height + 0.5] : [0.5, height + 0.5, width + 0.5, 0.5]];
    return lines.map(line => ({...stroke, border, x1: line[0]!, y1: line[1]!, x2: line[2]!, y2: line[3]!}));
  });
}
