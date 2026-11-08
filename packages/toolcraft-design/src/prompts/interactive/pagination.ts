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

  let end = start + cappedVisibleCount;
  const visible = options
    .slice(start, end)
    .map((option, index) => wrapAnsi(style(option, start + index === cursor), columns, { hard: true, trim: false }));
  const marker = wrapAnsi(color.dim(GLYPHS.ellipsis), columns, { hard: true, trim: false });
  const markerRows = marker.split("\n").length;

  while (visible.length > 1 && countLines(visible) + markerRows * (Number(start > 0) + Number(end < options.length)) > rowBudget) {
    if (start < cursor) {
      visible.shift();
      start += 1;
    } else {
      visible.pop();
      end -= 1;
    }
  }

  let remainingRows = rowBudget - countLines(visible);
  if (start > 0 && remainingRows >= markerRows) {
    visible.unshift(marker);
    remainingRows -= markerRows;
  }
  if (end < options.length && remainingRows >= markerRows) {
    visible.push(marker);
  }

  return visible;
}
