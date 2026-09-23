import { getEmbeddedFont, getGlyphOutline } from "./font.js";

export interface MeasuredLine {
  readonly text: string;
  readonly width: number;
}

export interface MeasuredTextBlock {
  readonly lines: readonly MeasuredLine[];
  readonly width: number;
  readonly height: number;
}

export interface MeasureTextOptions {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontFamily?: "ui" | "mono" | undefined;
  readonly fontWeight?: 400 | 500 | 600 | 700 | undefined;
}

export function normalizeLabelText(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === "\r") {
      if (input[i + 1] === "\n") i++;
      out += "\n";
      i++;
      continue;
    }
    if (ch === "\\" && input[i + 1] === "n") {
      out += "\n";
      i += 2;
      continue;
    }
    if (ch === "<") {
      const lower = input.slice(i, i + 6).toLowerCase();
      if (lower.startsWith("<br>")) {
        out += "\n";
        i += 4;
        continue;
      }
      if (lower.startsWith("<br/>")) {
        out += "\n";
        i += 5;
        continue;
      }
      if (lower.startsWith("<br />")) {
        out += "\n";
        i += 6;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

export function measureLineWidth(
  line: string,
  fontSize: number,
  fontFamily: "ui" | "mono" = "ui",
  fontWeight: 400 | 500 | 600 | 700 = 500
): number {
  if (line.length === 0) return 0;
  const unitsPerEm = getEmbeddedFont().unitsPerEm;
  let totalUnits = 0;
  for (const symbol of line) {
    const cp = symbol.codePointAt(0)!;
    const glyph = getGlyphOutline(cp, fontFamily, fontWeight);
    totalUnits += glyph.advanceWidth;
  }
  return Math.ceil(((totalUnits / unitsPerEm) * fontSize) * 100) / 100;
}

export function measureTextBlock(
  rawText: string,
  options: MeasureTextOptions
): MeasuredTextBlock {
  const fontFamily = options.fontFamily ?? "ui";
  const fontWeight = options.fontWeight ?? 500;
  const normalized = normalizeLabelText(rawText);
  const rawLines = normalized.split("\n");
  const lines: MeasuredLine[] = [];
  let maxWidth = 0;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    const width = measureLineWidth(trimmed, options.fontSize, fontFamily, fontWeight);
    if (width > maxWidth) maxWidth = width;
    lines.push({ text: trimmed, width });
  }

  if (lines.length === 0) {
    lines.push({ text: "", width: 0 });
  }

  return {
    lines,
    width: maxWidth,
    height: lines.length * options.lineHeight
  };
}
