import type { ThemePalette } from "../tokens/colors.js";
import { widths } from "../tokens/widths.js";
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
  variant?: "table" | "detail";
  maxWidth?: number;
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
const minCellWidth = 4;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function getCell(row: Record<string, string>, name: string): string {
  return Object.prototype.hasOwnProperty.call(row, name) ? row[name] ?? "" : "";
}

function renderMarkdownCell(value: string): string {
  return stripAnsi(value)
    .replaceAll("\r\n", " ")
    .replaceAll("\n", " ")
    .replaceAll("\r", " ")
    .replaceAll("|", "\\|");
}

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
  if (!Number.isFinite(column.maxLen) || column.maxLen <= 0) {
    throw new Error("maxLen must be a positive finite number.");
  }
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

// Each column is framed as "│ cell ", plus the closing "│".
function frameWidth(columnCount: number): number {
  return columnCount * 3 + 1;
}

// Log output indents every line with a "│  " guide, so a table emitted through the
// logger has that much less room than the terminal. Undefined without a terminal:
// piped output has no width to fit.
export function loggerTableWidth(): number | undefined {
  const columns = process.stdout.columns;
  return columns === undefined ? undefined : columns - 3;
}

// Without an explicit budget or a TTY there is no width to fit: the consumer of the
// piped output decides, so columns keep their declared widths.
function budgetColumns(columns: ComputedColumn[], maxWidth: number | undefined): ComputedColumn[] {
  if (maxWidth === undefined) {
    return columns;
  }

  const available = maxWidth - frameWidth(columns.length);
  const contentWidth = (cap: number) =>
    columns.reduce((total, column) => total + Math.min(column.width, cap), 0);

  if (columns.reduce((total, column) => total + column.width, 0) <= available) {
    return columns;
  }

  // Widest-first: raise a shared cap as far as the budget allows, so narrow columns
  // keep their declared width and only the columns above the cap lose room.
  let cap = minCellWidth;
  while (contentWidth(cap + 1) <= available) {
    cap += 1;
  }

  const budgeted = columns.map((column) => ({ ...column, width: Math.min(column.width, cap) }));
  let slack = available - contentWidth(cap);
  while (slack > 0) {
    const growable = budgeted.filter((column, index) => column.width < columns[index]!.width);
    if (growable.length === 0) {
      break;
    }
    for (const column of growable) {
      if (slack === 0) {
        break;
      }
      column.width += 1;
      slack -= 1;
    }
  }

  return budgeted;
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

function wrapDetailValue(value: string, width: number): string[] {
  const lines: string[] = [];

  for (const paragraph of value.split("\n")) {
    let line = "";

    for (const rawWord of paragraph.split(" ")) {
      const words: string[] = [];
      let word = rawWord;

      while (displayWidth(word) > width) {
        let chunk = "";
        let index = 0;

        while (index < word.length) {
          const cluster = readPrintableCluster(word, index);
          if (displayWidth(`${chunk}${cluster}`) > width) {
            break;
          }
          chunk += cluster;
          index += cluster.length;
        }

        words.push(chunk);
        word = word.slice(chunk.length);
      }

      words.push(word);

      for (const word of words) {
        if (line.length === 0) {
          line = word;
          continue;
        }

        if (displayWidth(`${line} ${word}`) <= width) {
          line = `${line} ${word}`;
          continue;
        }

        lines.push(line);
        line = word;
      }
    }

    lines.push(line);
  }

  return lines.length > 0 ? lines : [""];
}

function renderTableTerminal(options: RenderTableOptions): string {
  const { theme, columns, rows } = options;
  const computedColumns = computeColumns(columns);
  if (options.variant === "detail") {
    const labelColumn = computedColumns[0];
    const valueColumn = computedColumns[1];
    if (!labelColumn || !valueColumn) {
      return "";
    }

    const detailLabelWidth = widths.helpColumn + 12;
    const labelWidth = Math.min(labelColumn.width, detailLabelWidth);
    const valueWidth = Math.max(20, (options.maxWidth ?? widths.maxLine) - labelWidth - 2);
    const continuation = " ".repeat(labelWidth + 2);

    return rows
      .flatMap((row) => {
        const label = truncateToWidth(getCell(row, labelColumn.name), labelWidth);
        const values = wrapDetailValue(getCell(row, valueColumn.name), valueWidth);
        if (values.length === 1 && values[0] === "") {
          return [theme.header(label)];
        }
        return [
          `${theme.muted(padCell(label, labelWidth, "left"))}  ${values[0] ?? ""}`,
          ...values.slice(1).map((value) => `${continuation}${value}`)
        ];
      })
      .join("\n");
  }

  const separatorOptions = options as { rowSeparator?: boolean; rowSeparators?: boolean };
  const includeRowSeparators =
    separatorOptions.rowSeparator === true || separatorOptions.rowSeparators === true;

  const budgetedColumns = budgetColumns(computedColumns, options.maxWidth ?? process.stdout.columns);

  const top = renderBorder(budgetedColumns, theme, { left: "┌", mid: "┬", right: "┐" });
  const header = renderTerminalRow(
    budgetedColumns.map((column) => theme.header(column.title)),
    budgetedColumns,
    theme
  );
  const headerBottom = renderBorder(budgetedColumns, theme, { left: "├", mid: "┼", right: "┤" });
  const bottom = renderBorder(budgetedColumns, theme, { left: "└", mid: "┴", right: "┘" });

  const renderedRows: string[] = [];
  for (const [index, row] of rows.entries()) {
    if (includeRowSeparators && index > 0) {
      renderedRows.push(headerBottom);
    }
    renderedRows.push(
      renderTerminalRow(
        budgetedColumns.map((column) => getCell(row, column.name)),
        budgetedColumns,
        theme
      )
    );
  }

  return [top, header, headerBottom, ...renderedRows, bottom].join("\n");
}

function renderTableMarkdown(options: RenderTableOptions): string {
  const { columns, rows } = options;

  const header = `| ${columns.map((c) => renderMarkdownCell(c.title)).join(" | ")} |`;
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
      `| ${columns.map((c) => renderMarkdownCell(getCell(row, c.name))).join(" | ")} |`
  );

  return [header, separator, ...dataRows].join("\n");
}

function renderTableJson(options: RenderTableOptions): string {
  const { columns, rows } = options;

  const cleaned = rows.map((row) => {
    const obj = Object.create(null) as Record<string, string>;
    for (const col of columns) {
      obj[col.name] = stripAnsi(getCell(row, col.name));
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
