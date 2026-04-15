import { resolveThemeName } from "../../internal/theme-detect.js";
import { hasAnsi, parseAnsi, type StyledSegment } from "../ansi.js";
import { ScreenBuffer } from "../buffer.js";
import type { CellStyle, OutputItem, OutputItemKind, Rect } from "../types.js";

const TEXT_OFFSET = 3;
const CONTINUATION_PREFIX = "│";

type WrapToken = { kind: "space"; value: string } | { kind: "word"; value: string };

export type OutputPaneState = {
  items: OutputItem[];
  scrollOffset: number;
  autoFollow: boolean;
};

export type VisualLine = {
  text: string;
  style: CellStyle;
  prefix: string;
  prefixStyle: CellStyle;
  segments?: StyledSegment[];
};

export function renderOutputPane(buffer: ScreenBuffer, rect: Rect, state: OutputPaneState): void {
  buffer.clearRect(rect);

  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  const visualLines = computeVisualLines(state.items, rect.width);
  const startLine = state.autoFollow
    ? Math.max(visualLines.length - rect.height, 0)
    : clampScrollOffset(state.scrollOffset, visualLines.length);
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
        offsetX += countCells(segment.text);
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

  const themeName = resolveThemeName();
  const mutedStyle = getMutedStyle(themeName);
  const textWidth = Math.max(width - TEXT_OFFSET, 0);
  const visualLines: VisualLine[] = [];

  for (const item of items) {
    const itemStyle = getItemStyle(item.kind, themeName);

    if (hasAnsi(item.text)) {
      const styledLines = parseAnsi(item.text, {});
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

function hardWrapSegments(segments: StyledSegment[], width: number): StyledSegment[][] {
  if (width <= 0) {
    return [[]];
  }

  const rows: StyledSegment[][] = [[]];
  let rowWidth = 0;

  for (const segment of segments) {
    if (segment.text.length === 0) {
      continue;
    }

    const chars = [...segment.text];
    let cursor = 0;

    while (cursor < chars.length) {
      const space = width - rowWidth;
      if (space <= 0) {
        rows.push([]);
        rowWidth = 0;
        continue;
      }
      const take = chars.slice(cursor, cursor + space).join("");
      const currentRow = rows[rows.length - 1]!;
      currentRow.push({ text: take, style: { ...segment.style } });
      rowWidth += Math.min(space, chars.length - cursor);
      cursor += space;
      if (cursor < chars.length) {
        rows.push([]);
        rowWidth = 0;
      }
    }
  }

  return rows;
}

function countCells(text: string): number {
  return Array.from(text).length;
}

export function scrollUp(state: OutputPaneState, lines: number): OutputPaneState {
  return {
    ...state,
    autoFollow: false,
    scrollOffset: Math.max(0, state.scrollOffset - normalizeCount(lines))
  };
}

export function scrollDown(
  state: OutputPaneState,
  lines: number,
  totalVisualLines: number
): OutputPaneState {
  return {
    ...state,
    autoFollow: false,
    scrollOffset: Math.min(
      clampScrollOffset(totalVisualLines - 1, totalVisualLines),
      state.scrollOffset + normalizeCount(lines)
    )
  };
}

export function scrollToTop(state: OutputPaneState): OutputPaneState {
  return {
    ...state,
    autoFollow: false,
    scrollOffset: 0
  };
}

export function scrollToBottom(
  state: OutputPaneState,
  totalVisualLines: number,
  paneHeight: number
): OutputPaneState {
  return {
    ...state,
    autoFollow: true,
    scrollOffset: Math.max(0, normalizeCount(totalVisualLines) - normalizeCount(paneHeight))
  };
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

function getItemStyle(kind: OutputItemKind, themeName: "dark" | "light"): CellStyle {
  if (kind === "success") {
    return themeName === "light" ? { fg: "#008800" } : { fg: "green" };
  }

  if (kind === "error") {
    return themeName === "light" ? { fg: "#cc0000" } : { fg: "red" };
  }

  if (kind === "tool") {
    return getMutedStyle(themeName);
  }

  if (kind === "status") {
    return themeName === "light" ? { fg: "#a200ff" } : { fg: "magenta" };
  }

  return themeName === "light" ? { fg: "#a200ff" } : { fg: "magenta" };
}

function getMutedStyle(themeName: "dark" | "light"): CellStyle {
  return themeName === "light" ? { fg: "#666666" } : { dim: true };
}

function wrapText(value: string, width: number): string[] {
  const logicalLines = splitLogicalLines(value);

  if (logicalLines.length === 0) {
    return [""];
  }

  if (width <= 0) {
    return logicalLines.map(() => "");
  }

  return logicalLines.flatMap((line) => wrapParagraph(line, width));
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

      if (currentLine.length > 0 && currentLine.length + gap.length + chunk.length > width) {
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
  if (value.length <= width) {
    return [value];
  }

  const chunks: string[] = [];

  for (let index = 0; index < value.length; index += width) {
    chunks.push(value.slice(index, index + width));
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

function clampScrollOffset(scrollOffset: number, totalVisualLines: number): number {
  const maxOffset = Math.max(0, normalizeCount(totalVisualLines) - 1);
  return Math.max(0, Math.min(normalizeCount(scrollOffset), maxOffset));
}

function normalizeCount(value: number): number {
  return Math.max(0, Math.floor(value));
}

function isWrappingSpace(ch: string): boolean {
  return ch === " " || ch === "\t";
}
