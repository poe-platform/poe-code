import type { ThemePalette } from "../tokens/colors.js";
import { widths } from "../tokens/widths.js";

export interface DetailCardRow {
  label: string;
  value: string;
}

export interface DetailCardSection {
  title?: string;
  rows: DetailCardRow[];
}

export interface RenderDetailCardOptions {
  theme: ThemePalette;
  title: string;
  subtitle?: string;
  badges?: string[];
  prose?: Array<{ title?: string; value: string }>;
  sections?: DetailCardSection[];
  width?: number;
}

function wrap(value: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    let line = "";

    for (const rawWord of paragraph.split(" ")) {
      const words: string[] = [];
      let word = rawWord;
      while (word.length > width) {
        words.push(word.slice(0, width));
        word = word.slice(width);
      }
      words.push(word);

      for (const word of words) {
        if (line.length === 0) {
          line = word;
          continue;
        }
        if (`${line} ${word}`.length <= width) {
          line = `${line} ${word}`;
          continue;
        }
        lines.push(line);
        line = word;
      }
    }

    lines.push(line);
  }
  return lines;
}

function renderRows(rows: DetailCardRow[], theme: ThemePalette, width: number): string[] {
  if (rows.length === 0) return [];
  const labelWidth = Math.max(...rows.map((row) => row.label.length));
  const valueWidth = Math.max(20, width - labelWidth - 2);
  const continuation = " ".repeat(labelWidth + 2);

  return rows.flatMap((row) => {
    const values = wrap(row.value, valueWidth);
    return [
      `${theme.muted(row.label.padEnd(labelWidth))}  ${values[0] ?? ""}`,
      ...values.slice(1).map((value) => `${continuation}${value}`),
    ];
  });
}

export function renderDetailCard(options: RenderDetailCardOptions): string {
  const width = options.width ?? widths.maxLine;
  const identity = [
    options.theme.header(options.title),
    options.subtitle ? options.theme.muted(options.subtitle) : undefined,
  ].filter((value): value is string => value !== undefined).join("  ");

  const hero = options.badges?.length
    ? `${identity}\n${options.theme.muted(options.badges.map((badge) => badge[0] + badge.slice(1).toLowerCase()).join(" · "))}`
    : identity;
  const blocks: string[] = [hero];
  for (const prose of options.prose ?? []) {
    blocks.push(prose.title
      ? [options.theme.header(prose.title), wrap(prose.value, width).join("\n")].join("\n")
      : wrap(prose.value, width).join("\n"));
  }

  for (const section of options.sections ?? []) {
    if (section.rows.length === 0) continue;
    const rows = renderRows(section.rows, options.theme, width);
    blocks.push(section.title
      ? [options.theme.header(section.title), ...rows].join("\n")
      : rows.join("\n"));
  }

  return blocks.join("\n\n");
}
