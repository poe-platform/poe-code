// Gnumeric 1.12.61 plugins/html/latex.c, GPL-2.0-or-later.
import type { Range } from "../workbook.js";
import type { MetadataNode } from "./xlsx-write-support.js";
const connectors: readonly string[] = ["", "", "", "", "", "", "", "", "|", "", "32", "", "", "", "11", "", "", "|t:", "", "", "", "", "", "", "", "|", "|", "", "33", "", "1", "", "13", "", "34", "", "", "", "", "", "|", "|", "", "|b|", "14", "", "|", "|", "", "|b:", "|b:", "", "|", ":", "", "", "", "", "", "", "", "", "|", "", "35", "", "", "|", "17", "", "36", "", "", "|", "|", "", "37", "", "|", "", "", "", "38", "", "4", "", "19", "", "39", "", "", "|b|", "20", "", "|", "|", "5", "", "21", "", "|", "|", "|b:", "", "22", "", "40", "", "", "", "23", "", ":t|", "", "|", "", "24", "", ":t|", "", "", "", "", "", ":t:", "", "7", "", "26", "", ":t|", "", "8", "", "27", "", "43", "", "", "", "", "", ":t:", "", ":b|", "", "29", "", ":", "|", ":b|", "", "30", "", ":|", "", ":b:", "", ":b:", "", ":", ":"];
const borderClass = [0, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 0];
const horizontal = ["~", "-", "-", "-", "-", "=", "=", "-", "-", "-", "-", "-", "-", ""];
export function latexBorders(styleAt: (row: number, column: number) => MetadataNode | undefined, merges: readonly Range[], tick: (amount?: number) => void) {
  function border(row: number, column: number, edge: string): number {
    tick(); if (row < 0 || column < 0) return 0;
    const value = Number(styleAt(row, column)?.children.find(n => n.name === "StyleBorder")?.children.find(n => n.name === edge)?.attributes.Style ?? 0);
    return Number.isInteger(value) && value >= 0 && value < borderClass.length ? value : 0;
  }
  function mergeAt(row: number, column: number) {
    return merges.find(m => { tick(); return row >= m.startRow && row <= m.endRow && column >= m.startColumn && column <= m.endColumn; });
  }
  function vertical(row: number, column: number, edge: "Left" | "Right"): number {
    let result = border(row, column, edge);
    if (result === 0 || result === 13) result = border(row, column + (edge === "Left" ? -1 : 1), edge === "Left" ? "Right" : "Left");
    if (!result) return 0;
    const merge = mergeAt(row, column);
    return merge && (edge === "Left" ? column !== merge.startColumn : column !== merge.endColumn) ? 0 : result;
  }
  function rowVertical(row: number, start: number, end: number): number[] {
    const result = [vertical(row, start, "Left")];
    for (let col = start; col <= end; col++) result.push(vertical(row, col, "Right"));
    return result;
  }
  function rowHorizontal(row: number, start: number, end: number, previous: boolean): { lines: number[]; present: boolean } {
    let present = false;
    const lines: number[] = [];
    for (let col = start; col <= end; col++) {
      let line = 0;
      const edges: [number, string][] = [[row, "Top"]];
      if (previous) edges.push([row - 1, "Bottom"]);
      for (const [r, edge] of edges) {
        const next = border(r, col, edge);
        if (!next || next === 13) continue;
        const merge = mergeAt(r, col);
        if (merge && (edge === "Top" ? r > merge.startRow : r < merge.endRow)) { line = 0; continue; }
        line = next; present = true;
      }
      lines.push(line);
    }
    return { lines, present };
  }
  function hhline(lines: readonly number[], previous?: readonly number[], next?: readonly number[]): string {
    let result = "\\hhline{";
    function connector(left: number, index: number, right: number) {
      tick(); const at = (((borderClass[left]! * 3 + borderClass[previous?.[index] ?? 0]!) * 3 + borderClass[right]!) * 3 + borderClass[next?.[index] ?? 0]!) * 2;
      result += connectors[at]! + connectors[at + 1]!;
    }
    connector(0, 0, lines[0]!);
    for (let col = 0; col < lines.length; col++) { tick(); result += horizontal[lines[col]!]!; connector(lines[col]!, col + 1, lines[col + 1] ?? 0); }
    return result + "}\n";
  }
  return { rowVertical, rowHorizontal, hhline, verticalSyntax: (line: number) => borderClass[line] === 2 ? "||" : borderClass[line] === 1 ? "|" : "" };
}
