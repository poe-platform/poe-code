import type {Range} from "@poe-code/spreadsheet-ast";

/** Index merge rectangles without expanding their potentially sheet-sized area. */
export function createPrintMerges(ranges: readonly Range[], tick: (amount?: number) => void) {
  tick(ranges.length);
  const sorted = [...ranges].sort((a, b) => {tick(); return a.startRow - b.startRow || a.startColumn - b.startColumn;});
  interface Node {range: Range; end: number; left?: Node; right?: Node}
  const build = (start: number, end: number): Node | undefined => {
    if (start >= end) return undefined;
    tick();
    const middle = (start + end) >>> 1, range = sorted[middle]!;
    const left = build(start, middle), right = build(middle + 1, end);
    return {range, end: Math.max(range.endRow, left?.end ?? -1, right?.end ?? -1), ...(left ? {left} : {}), ...(right ? {right} : {})};
  };
  const root = build(0, sorted.length);
  return (row: number): readonly Range[] => {
    const found: Range[] = [], pending = root ? [root] : [];
    while (pending.length) {
      tick();
      const node = pending.pop()!;
      if (node.end < row) continue;
      if (node.left) pending.push(node.left);
      if (node.range.startRow > row) continue;
      if (node.range.endRow >= row) found.push(node.range);
      if (node.right) pending.push(node.right);
    }
    return found;
  };
}
