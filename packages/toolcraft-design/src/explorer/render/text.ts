import { displayWidth, graphemes } from "../../dashboard/terminal-width.js";

const ELLIPSIS = "…";

export interface GraphemeCell {
  value: string;
  start: number;
  end: number;
  width: number;
}

export function cellWidth(value: string, startColumn = 0): number {
  return displayWidth(value, startColumn);
}

export function fitToWidth(text: string, width: number, startColumn = 0): string {
  if (width <= 0) {
    return "";
  }

  if (cellWidth(text, startColumn) <= width) {
    return text;
  }

  const ellipsisWidth = cellWidth(ELLIPSIS, startColumn);
  if (ellipsisWidth > width) {
    return takeCells(text, width, startColumn);
  }

  const prefix = takeCells(text, width - ellipsisWidth, startColumn);
  return `${prefix}${ELLIPSIS}`;
}

export function centerCells(text: string, width: number, startColumn = 0): string {
  const fitted = fitToWidth(text, width, startColumn);
  const padding = Math.max(0, Math.floor((width - cellWidth(fitted, startColumn)) / 2));
  return `${" ".repeat(padding)}${fitted}`;
}

export function padEndCells(text: string, width: number, fill = " ", startColumn = 0): string {
  let output = takeCells(text, width, startColumn);
  let used = cellWidth(output, startColumn);
  let column = startColumn + used;

  while (used < width) {
    const fillWidth = cellWidth(fill, column);
    if (fill.length === 0 || fillWidth <= 0 || used + fillWidth > width) {
      const spaces = width - used;
      output += " ".repeat(spaces);
      used += spaces;
      column += spaces;
      continue;
    }

    output += fill;
    used += fillWidth;
    column += fillWidth;
  }

  return output;
}

export function splitGraphemeCells(value: string, startColumn = 0): GraphemeCell[] {
  const cells: GraphemeCell[] = [];
  let offset = 0;
  let column = startColumn;

  for (const segment of graphemes(value)) {
    const width = cellWidth(segment, column);
    cells.push({
      value: segment,
      start: offset,
      end: offset + segment.length,
      width
    });
    offset += segment.length;
    column += width;
  }

  return cells;
}

export function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function takeCells(text: string, width: number, startColumn: number): string {
  if (width <= 0) {
    return "";
  }

  let output = "";
  let used = 0;
  let column = startColumn;

  for (const segment of graphemes(text)) {
    const segmentWidth = cellWidth(segment, column);
    if (used + segmentWidth > width) {
      break;
    }

    output += segment;
    used += segmentWidth;
    column += segmentWidth;
  }

  return output;
}
