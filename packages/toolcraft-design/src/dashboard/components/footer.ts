import { getTheme } from "../../internal/theme-detect.js";
import { displayWidth, graphemes, graphemeWidth, truncateToWidth } from "../terminal-width.js";
import { ScreenBuffer } from "../buffer.js";
import type { CellStyle, Rect } from "../types.js";

export type FooterHint = {
  key: string;
  label: string;
};

export function renderFooter(buffer: ScreenBuffer, rect: Rect, hints: FooterHint[]): void {
  buffer.clearRect(rect);

  if (rect.width <= 0 || rect.height <= 0 || hints.length === 0) {
    return;
  }

  const fitted: FooterHint[] = [];
  let width = 0;
  for (const hint of hints) {
    const nextWidth = displayWidth(`${hint.key} ${hint.label}`) + (fitted.length > 0 ? 2 : 0);
    if (width + nextWidth > rect.width) break;
    fitted.push(hint);
    width += nextWidth;
  }
  if (fitted.length === 0) {
    const key = truncateToWidth(hints[0]!.key, rect.width);
    fitted.push({ key, label: "" });
    width = displayWidth(key);
  }
  const cells = hintsToCells(fitted);
  let x = rect.x + Math.floor((rect.width - width) / 2);
  const y = rect.y + Math.floor(rect.height / 2);

  cells.forEach((cell) => {
    buffer.put(x, y, cell.ch, cell.style);
    x += graphemeWidth(cell.ch);
  });
}

export function defaultHints(): FooterHint[] {
  return [
    { key: "q", label: "Quit" },
    { key: "e", label: "Edit" },
    { key: "l", label: "Log" },
    { key: "p", label: "Pause" },
    { key: "r", label: "Retry" }
  ];
}

function hintsToCells(hints: FooterHint[]): Array<{ ch: string; style: CellStyle }> {
  const accentStyle = getAccentStyle();
  const cells: Array<{ ch: string; style: CellStyle }> = [];

  hints.forEach((hint, hintIndex) => {
    if (hintIndex > 0) {
      cells.push({ ch: " ", style: {} }, { ch: " ", style: {} });
    }

    for (const ch of graphemes(hint.key)) {
      cells.push({ ch, style: accentStyle });
    }

    if (hint.label.length > 0) cells.push({ ch: " ", style: {} });

    for (const ch of graphemes(hint.label)) {
      cells.push({ ch, style: {} });
    }
  });

  return cells;
}

function getAccentStyle(): CellStyle {
  return getTheme().styles.accent;
}
