import type { ThemePalette } from "../tokens/colors.js";
import { resolveOutputFormat } from "../internal/output-format.js";
import { stripAnsi } from "../internal/strip-ansi.js";

export interface TableColumn {
  name: string;
  title: string;
  alignment: "left" | "right";
  maxLen: number;
}

export interface RenderTableOptions {
  theme: ThemePalette;
  columns: TableColumn[];
  rows: Record<string, string>[];
}

type TableAlignment = TableColumn["alignment"] | "center";

interface ComputedColumn {
  name: string;
  title: string;
  alignment: TableAlignment;
  width: number;
}

const reset = "\x1b[0m";
const ellipsis = "…";
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function isAnsiSequence(value: string, index: number): boolean {
  return value[index] === "\u001b" && value[index + 1] === "[";
}

function readAnsiSequence(value: string, index: number): { sequence: string; nextIndex: number } {
  let nextIndex = index + 2;
  while (nextIndex < value.length && value[nextIndex] !== "m") {
    nextIndex += 1;
  }

  if (nextIndex < value.length) {
    nextIndex += 1;
  }

  return { sequence: value.slice(index, nextIndex), nextIndex };
}

function isCombiningCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function isEmojiClusterCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf)
  );
}

function codePointWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;

  if (codePoint === 0 || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return 0;
  }

  if (
    codePoint === 0x200d ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    isCombiningCodePoint(codePoint)
  ) {
    return 0;
  }

  return isWideCodePoint(codePoint) ? 2 : 1;
}

function readPrintableCluster(value: string, index: number): string {
  const nextAnsiIndex = value.indexOf("\u001b[", index);
  const plainText = value.slice(index, nextAnsiIndex === -1 ? undefined : nextAnsiIndex);
  const firstSegment = graphemeSegmenter.segment(plainText)[Symbol.iterator]().next().value as
    | Intl.SegmentData
    | undefined;

  return firstSegment?.segment ?? Array.from(plainText)[0] ?? "";
}

function clusterWidth(cluster: string): number {
  const codePoints = Array.from(cluster).map((char) => char.codePointAt(0) ?? 0);
  const isEmojiCluster =
    codePoints.length > 1 &&
    codePoints.some(
      (codePoint) =>
        codePoint === 0x200d ||
        (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
        isEmojiClusterCodePoint(codePoint)
    );

  if (isEmojiCluster) {
    return 2;
  }

  return codePoints.reduce((width, codePoint) => width + codePointWidth(String.fromCodePoint(codePoint)), 0);
}

function displayWidth(value: string): number {
  let width = 0;
  let index = 0;

  while (index < value.length) {
    if (isAnsiSequence(value, index)) {
      index = readAnsiSequence(value, index).nextIndex;
      continue;
    }

    const cluster = readPrintableCluster(value, index);
    width += clusterWidth(cluster);
    index += cluster.length;
  }

  return width;
}

function truncateToWidth(value: string, width: number): string {
  if (displayWidth(value) <= width) {
    return value;
  }

  if (width <= 0) {
    return "";
  }

  const targetWidth = width <= 1 ? 0 : width - displayWidth(ellipsis);
  let output = "";
  let currentWidth = 0;
  let index = 0;
  let sawAnsi = false;

  while (index < value.length) {
    if (isAnsiSequence(value, index)) {
      const ansi = readAnsiSequence(value, index);
      sawAnsi = true;
      output += ansi.sequence;
      index = ansi.nextIndex;
      continue;
    }

    const cluster = readPrintableCluster(value, index);
    const width = clusterWidth(cluster);
    if (currentWidth + width > targetWidth) {
      break;
    }

    output += cluster;
    currentWidth += width;
    index += cluster.length;
  }

  return `${output}${ellipsis}${sawAnsi ? reset : ""}`;
}

function padCell(value: string, width: number, alignment: TableAlignment): string {
  const visibleWidth = displayWidth(value);
  const padding = Math.max(0, width - visibleWidth);

  if (alignment === "right") {
    return `${" ".repeat(padding)}${value}`;
  }

  if (alignment === "center") {
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return `${" ".repeat(left)}${value}${" ".repeat(right)}`;
  }

  return `${value}${" ".repeat(padding)}`;
}

function getAlignment(column: TableColumn): TableAlignment {
  const alignment = (column as { alignment: TableAlignment }).alignment;
  return alignment === "right" || alignment === "center" ? alignment : "left";
}

function getColumnWidth(column: TableColumn): number {
  const configuredMin = (column as { minLen?: number }).minLen;
  const minWidth = Math.max(1, configuredMin ?? 1);
  return Math.max(minWidth, column.maxLen);
}

function computeColumns(columns: TableColumn[]): ComputedColumn[] {
  return columns.map((column) => ({
    name: column.name,
    title: column.title,
    alignment: getAlignment(column),
    width: getColumnWidth(column)
  }));
}

function renderBorder(
  columns: ComputedColumn[],
  theme: ThemePalette,
  parts: { left: string; mid: string; right: string }
): string {
  const horizontal = theme.muted("─");
  const segments = columns.map((column) => horizontal.repeat(column.width + 2));
  return [
    theme.muted(parts.left),
    segments.join(theme.muted(parts.mid)),
    theme.muted(parts.right)
  ].join("");
}

function renderTerminalRow(values: string[], columns: ComputedColumn[], theme: ThemePalette): string {
  const vertical = theme.muted("│");
  const cells = values.map((value, index) => {
    const column = columns[index]!;
    const truncated = truncateToWidth(value, column.width);
    return ` ${padCell(truncated, column.width, column.alignment)} `;
  });

  return `${vertical}${cells.join(vertical)}${vertical}`;
}

function renderTableTerminal(options: RenderTableOptions): string {
  const { theme, columns, rows } = options;
  const computedColumns = computeColumns(columns);
  const separatorOptions = options as { rowSeparator?: boolean; rowSeparators?: boolean };
  const includeRowSeparators =
    separatorOptions.rowSeparator === true || separatorOptions.rowSeparators === true;

  const top = renderBorder(computedColumns, theme, { left: "┌", mid: "┬", right: "┐" });
  const header = renderTerminalRow(
    computedColumns.map((column) => theme.header(column.title)),
    computedColumns,
    theme
  );
  const headerBottom = renderBorder(computedColumns, theme, { left: "├", mid: "┼", right: "┤" });
  const bottom = renderBorder(computedColumns, theme, { left: "└", mid: "┴", right: "┘" });

  const renderedRows: string[] = [];
  for (const [index, row] of rows.entries()) {
    if (includeRowSeparators && index > 0) {
      renderedRows.push(headerBottom);
    }
    renderedRows.push(
      renderTerminalRow(
        computedColumns.map((column) => row[column.name] ?? ""),
        computedColumns,
        theme
      )
    );
  }

  return [top, header, headerBottom, ...renderedRows, bottom].join("\n");
}

function renderTableMarkdown(options: RenderTableOptions): string {
  const { columns, rows } = options;

  const header = `| ${columns.map((c) => c.title).join(" | ")} |`;
  const separator = `| ${columns
    .map((c) => {
      const alignment = getAlignment(c);
      if (alignment === "right") {
        return "---:";
      }
      if (alignment === "center") {
        return ":---:";
      }
      return ":---";
    })
    .join(" | ")} |`;

  const dataRows = rows.map(
    (row) =>
      `| ${columns.map((c) => stripAnsi(row[c.name] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`
  );

  return [header, separator, ...dataRows].join("\n");
}

function renderTableJson(options: RenderTableOptions): string {
  const { columns, rows } = options;

  const cleaned = rows.map((row) => {
    const obj: Record<string, string> = {};
    for (const col of columns) {
      obj[col.name] = stripAnsi(row[col.name] ?? "");
    }
    return obj;
  });

  return JSON.stringify(cleaned, null, 2);
}

export function renderTable(options: RenderTableOptions): string {
  const format = resolveOutputFormat();
  switch (format) {
    case "markdown":
      return renderTableMarkdown(options);
    case "json":
      return renderTableJson(options);
    default:
      return renderTableTerminal(options);
  }
}
