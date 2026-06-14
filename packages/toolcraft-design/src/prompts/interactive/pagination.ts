import { color } from "../../components/color.js";
import { GLYPHS } from "./glyphs.js";
import { getColumns, getRows } from "./wrap.js";
import { wrapAnsi } from "fast-wrap-ansi";

export interface PaginationOptions<Option> {
  cursor: number;
  options: Option[];
  style: (option: Option, active: boolean) => string;
  output: NodeJS.WritableStream;
  maxItems?: number;
  columnPadding?: number;
  rowPadding?: number;
}

function countLines(values: string[]): number {
  return values.reduce((sum, value) => sum + value.split("\n").length, 0);
}

function trimToRows(values: string[], cursorOffset: number, rows: number, hasTop: boolean, hasBottom: boolean): string[] {
  const output = [...values];
  while (countLines(output) > rows && output.length > 1) {
    const removeFromTop = hasTop && cursorOffset > 0;
    const removeFromBottom = hasBottom && cursorOffset < output.length - 1;
    if (removeFromTop) {
      output.shift();
      cursorOffset -= 1;
    } else if (removeFromBottom) {
      output.pop();
    } else {
      output.pop();
    }
  }
  return output;
}

export function limitOptions<Option>(opts: PaginationOptions<Option>): string[] {
  const {
    cursor,
    options,
    style,
    output,
    maxItems = Number.POSITIVE_INFINITY,
    columnPadding = 0,
    rowPadding = 4
  } = opts;

  if (options.length === 0) {
    return [];
  }

  const columns = Math.max(1, getColumns(output) - columnPadding);
  const rowBudget = Math.max(getRows(output) - rowPadding, 0);
  const visibleCount = Math.max(Math.min(maxItems, rowBudget), 5);
  const cappedVisibleCount = Math.min(visibleCount, options.length);
  let start = 0;

  if (cursor >= cappedVisibleCount - 3) {
    start = Math.max(Math.min(cursor - cappedVisibleCount + 3, options.length - cappedVisibleCount), 0);
  }

  const hasTopMarker = cappedVisibleCount < options.length && start > 0;
  const hasBottomMarker = cappedVisibleCount < options.length && start + cappedVisibleCount < options.length;
  const visible = options
    .slice(start, start + cappedVisibleCount)
    .map((option, index) => wrapAnsi(style(option, start + index === cursor), columns, { hard: true, trim: false }));
  const trimmed = trimToRows(
    visible,
    Math.max(cursor - start, 0),
    Math.max(rowBudget - Number(hasTopMarker) - Number(hasBottomMarker), 1),
    hasTopMarker,
    hasBottomMarker
  );

  if (hasTopMarker) {
    trimmed.unshift(color.dim(GLYPHS.ellipsis));
  }
  if (hasBottomMarker) {
    trimmed.push(color.dim(GLYPHS.ellipsis));
  }

  return trimmed;
}
