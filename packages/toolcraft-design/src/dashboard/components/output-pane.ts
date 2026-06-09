import { getTheme } from "../../internal/theme-detect.js";
import { hasAnsi, parseAnsi, type StyledSegment } from "../ansi.js";
import { ScreenBuffer } from "../buffer.js";
import { displayWidth, expandTabs, graphemes, graphemeWidth } from "../terminal-width.js";
import type { CellStyle, OutputItem, OutputItemKind, Rect } from "../types.js";

const TEXT_OFFSET = 3;
const CONTINUATION_PREFIX = "│";

type WrapToken = { kind: "space"; value: string } | { kind: "word"; value: string };

export type VisualLine = {
  text: string;
  style: CellStyle;
  prefix: string;
  prefixStyle: CellStyle;
  segments?: StyledSegment[];
};

export function renderOutputPane(buffer: ScreenBuffer, rect: Rect, items: OutputItem[]): void {
  buffer.clearRect(rect);

  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  const visualLines = computeVisualLines(items, rect.width);
  const startLine = Math.max(visualLines.length - rect.height, 0);
  const textRect: Rect = {
    x: rect.x + TEXT_OFFSET,
    y: rect.y,
    width: rect.width - TEXT_OFFSET,
    height: rect.height
  };

  for (let row = 0; row < rect.height; row += 1) {
    const line = visualLines[startLine + row];
    if (line === undefined) {
      continue;
    }

    buffer.putInRect(rect, row, line.prefix, line.prefixStyle);

    if (line.segments && line.segments.length > 0) {
      let offsetX = 0;
      for (const segment of line.segments) {
        if (segment.text.length === 0) {
          continue;
        }
        const remaining = textRect.width - offsetX;
        if (remaining <= 0) {
          break;
        }
        buffer.putInRect(
          {
            x: textRect.x + offsetX,
            y: textRect.y,
            width: remaining,
            height: textRect.height
          },
          row,
          segment.text,
          segment.style
        );
        offsetX += displayWidth(segment.text, offsetX);
      }
      continue;
    }

    buffer.putInRect(textRect, row, line.text, line.style);
  }
}

export function computeVisualLines(items: OutputItem[], width: number): VisualLine[] {
  if (width <= 0) {
    return [];
  }

  const mutedStyle = getTheme().styles.muted;
  const textWidth = Math.max(width - TEXT_OFFSET, 0);
  const visualLines: VisualLine[] = [];

  for (const item of items) {
    const itemStyle = getItemStyle(item.kind);

    if (hasAnsi(item.text) || hasCursorControls(item.text)) {
      const styledLines = parseAnsi(item.text, hasAnsi(item.text) ? {} : itemStyle);
      let firstRow = true;
      for (const styledLine of styledLines) {
        const rows = hardWrapSegments(styledLine.segments, textWidth);
        for (const rowSegments of rows) {
          visualLines.push({
            prefix: firstRow ? getPrefix(item.kind) : CONTINUATION_PREFIX,
            prefixStyle: firstRow ? itemStyle : mutedStyle,
            style: itemStyle,
            text: rowSegments.map((segment) => segment.text).join(""),
            segments: rowSegments
          });
          firstRow = false;
        }
      }
      continue;
    }

    const wrappedLines = wrapText(item.text, textWidth);
    for (let index = 0; index < wrappedLines.length; index += 1) {
      visualLines.push({
        prefix: index === 0 ? getPrefix(item.kind) : CONTINUATION_PREFIX,
        prefixStyle: index === 0 ? itemStyle : mutedStyle,
        style: itemStyle,
        text: wrappedLines[index] ?? ""
      });
    }
  }

  return visualLines;
}

function hasCursorControls(text: string): boolean {
  return text.includes("\r") || text.includes("\b");
}

function hardWrapSegments(segments: StyledSegment[], width: number): StyledSegment[][] {
  if (width <= 0) {
    return [[]];
  }

  const rows: StyledSegment[][] = [[]];
  let rowWidth = 0;

  for (const segment of segments) {
    for (const grapheme of graphemes(expandTabs(segment.text, rowWidth))) {
      const graphemeCells = graphemeWidth(grapheme);

      if (rowWidth > 0 && rowWidth + graphemeCells > width) {
        rows.push([]);
        rowWidth = 0;
      }

      appendSegment(rows[rows.length - 1]!, grapheme, segment.style);
      rowWidth += graphemeCells;
    }
  }

  return rows;
}

function appendSegment(segments: StyledSegment[], text: string, style: CellStyle): void {
  const last = segments[segments.length - 1];
  if (last && stylesEqual(last.style, style)) {
    last.text += text;
  } else {
    segments.push({ text, style: { ...style } });
  }
}

function stylesEqual(left: CellStyle, right: CellStyle): boolean {
  return (
    left.fg === right.fg &&
    left.bg === right.bg &&
    left.bold === right.bold &&
    left.dim === right.dim &&
    left.inverse === right.inverse &&
    left.underline === right.underline
  );
}

function getPrefix(kind: OutputItemKind): string {
  if (kind === "success") {
    return "◆";
  }

  if (kind === "error") {
    return "■";
  }

  if (kind === "tool") {
    return CONTINUATION_PREFIX;
  }

  if (kind === "status") {
    return "●";
  }

  return "◇";
}

function getItemStyle(kind: OutputItemKind): CellStyle {
  const styles = getTheme().styles;
  if (kind === "success") {
    return styles.success;
  }

  if (kind === "error") {
    return styles.error;
  }

  if (kind === "tool") {
    return styles.muted;
  }

  if (kind === "status") {
    return styles.info;
  }

  return styles.info;
}

function wrapText(value: string, width: number): string[] {
  const logicalLines = splitLogicalLines(value);

  if (logicalLines.length === 0) {
    return [""];
  }

  if (width <= 0) {
    return logicalLines.map(() => "");
  }

  return logicalLines.flatMap((line) => wrapParagraph(expandTabs(line), width));
}

function wrapParagraph(value: string, width: number): string[] {
  if (value.length === 0) {
    return [""];
  }

  const tokens = tokenize(value);
  const lines: string[] = [];
  let currentLine = "";
  let pendingSpace = "";

  const flushLine = (): void => {
    lines.push(currentLine);
    currentLine = "";
    pendingSpace = "";
  };

  for (const token of tokens) {
    if (token.kind === "space") {
      if (currentLine.length > 0) {
        pendingSpace += token.value;
      }
      continue;
    }

    const chunks = splitWord(token.value, width);

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index] ?? "";
      const gap = index === 0 ? pendingSpace : "";

      if (currentLine.length > 0 && displayWidth(`${currentLine}${gap}${chunk}`) > width) {
        flushLine();
      }

      if (currentLine.length > 0 && gap.length > 0) {
        currentLine += gap;
      }

      currentLine += chunk;
      pendingSpace = "";

      if (index < chunks.length - 1) {
        flushLine();
      }
    }
  }

  if (currentLine.length > 0 || lines.length === 0) {
    lines.push(currentLine);
  }

  return lines;
}

function splitWord(value: string, width: number): string[] {
  if (displayWidth(value) <= width) {
    return [value];
  }

  const chunks: string[] = [];
  let chunk = "";
  let chunkWidth = 0;

  for (const grapheme of graphemes(value)) {
    const graphemeCells = graphemeWidth(grapheme);
    if (chunk.length > 0 && chunkWidth + graphemeCells > width) {
      chunks.push(chunk);
      chunk = "";
      chunkWidth = 0;
    }
    chunk += grapheme;
    chunkWidth += graphemeCells;
  }

  if (chunk.length > 0) {
    chunks.push(chunk);
  }

  return chunks;
}

function tokenize(value: string): WrapToken[] {
  const tokens: WrapToken[] = [];
  let current = "";
  let currentKind: WrapToken["kind"] | undefined;

  for (const ch of value) {
    const nextKind: WrapToken["kind"] = isWrappingSpace(ch) ? "space" : "word";

    if (currentKind !== undefined && currentKind !== nextKind) {
      tokens.push({ kind: currentKind, value: current });
      current = "";
    }

    currentKind = nextKind;
    current += ch;
  }

  if (currentKind !== undefined) {
    tokens.push({ kind: currentKind, value: current });
  }

  return tokens;
}

function splitLogicalLines(value: string): string[] {
  const lines: string[] = [];
  let currentLine = "";

  for (const ch of value) {
    if (ch === "\r") {
      continue;
    }

    if (ch === "\n") {
      lines.push(currentLine);
      currentLine = "";
      continue;
    }

    currentLine += ch;
  }

  lines.push(currentLine);
  return lines;
}

function isWrappingSpace(ch: string): boolean {
  return ch === " " || ch === "\t";
}
