import { Table } from "console-table-printer";
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

function renderTableTerminal(options: RenderTableOptions): string {
  const { theme, columns, rows } = options;

  const table = new Table({
    style: {
      headerTop: {
        left: theme.muted("┌"),
        mid: theme.muted("┬"),
        right: theme.muted("┐"),
        other: theme.muted("─")
      },
      headerBottom: {
        left: theme.muted("├"),
        mid: theme.muted("┼"),
        right: theme.muted("┤"),
        other: theme.muted("─")
      },
      tableBottom: {
        left: theme.muted("└"),
        mid: theme.muted("┴"),
        right: theme.muted("┘"),
        other: theme.muted("─")
      },
      vertical: theme.muted("│"),
      rowSeparator: {
        left: theme.muted("├"),
        mid: theme.muted("┼"),
        right: theme.muted("┤"),
        other: theme.muted("─")
      }
    },
    columns: columns.map((col) => ({
      name: col.name,
      title: theme.header(col.title),
      alignment: col.alignment,
      maxLen: col.maxLen
    }))
  });

  for (const row of rows) {
    table.addRow(row);
  }

  return table.render();
}

function renderTableMarkdown(options: RenderTableOptions): string {
  const { columns, rows } = options;

  const header = `| ${columns.map((c) => c.title).join(" | ")} |`;
  const separator = `| ${columns.map((c) => (c.alignment === "right" ? "---:" : ":---")).join(" | ")} |`;

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
