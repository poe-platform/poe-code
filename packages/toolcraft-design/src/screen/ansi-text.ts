import { parseAnsi } from "../dashboard/ansi.js";
import { graphemes, graphemeWidth } from "../dashboard/terminal-width.js";
import type { CellStyle } from "../dashboard/types.js";
import { packStyle, type PackedStyle } from "./style.js";
import type { Cell } from "./screen.js";

const COLORS = new Map([
  ["black", 1], ["red", 1], ["green", 2], ["yellow", 3], ["blue", 4],
  ["magenta", 5], ["cyan", 6], ["white", 7], ["gray", 8]
]);

export function ansiToCells(text: string): Cell[] {
  const output: Cell[] = [];
  const lines = parseAnsi(text);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (lineIndex > 0) output.push(cell("\n", 1, 0));
    for (const segment of lines[lineIndex]!.segments) {
      const style = packed(segment.style);
      for (const grapheme of graphemes(segment.text)) output.push(cell(grapheme, graphemeWidth(grapheme) > 1 ? 2 : 1, style));
    }
  }
  return output;
}

function packed(style: CellStyle): PackedStyle {
  return packStyle({
    bold: style.bold,
    dim: style.dim,
    underline: style.underline,
    inverse: style.inverse,
    fg: colorNumber(style.fg),
    bg: colorNumber(style.bg)
  });
}
function colorNumber(value: string | undefined): number { return value === undefined ? 0 : (COLORS.get(value) ?? 0); }
function cell(ch: string, width: 1 | 2, style: PackedStyle): Cell {
  return { ch, width, style, fg: (style >> 8) & 0xff, bg: (style >> 16) & 0xff };
}
