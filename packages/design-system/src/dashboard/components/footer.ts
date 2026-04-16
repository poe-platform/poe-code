import { getTheme } from "../../internal/theme-detect.js";
import { light } from "../../tokens/colors.js";
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

  const cells = truncateCells(hintsToCells(hints), rect.width);
  const startX = rect.x + Math.floor((rect.width - cells.length) / 2);
  const y = rect.y + Math.floor(rect.height / 2);

  cells.forEach((cell, index) => {
    buffer.put(startX + index, y, cell.ch, cell.style);
  });
}

export function defaultHints(): FooterHint[] {
  return [
    { key: "q", label: "Quit" },
    { key: "e", label: "Edit" },
    { key: "p", label: "Pause" },
    { key: "r", label: "Retry" },
    { key: "↑↓", label: "Scroll" },
    { key: "F", label: "Follow" }
  ];
}

function hintsToCells(hints: FooterHint[]): Array<{ ch: string; style: CellStyle }> {
  const accentStyle = getAccentStyle();
  const cells: Array<{ ch: string; style: CellStyle }> = [];

  hints.forEach((hint, hintIndex) => {
    if (hintIndex > 0) {
      cells.push({ ch: " ", style: {} }, { ch: " ", style: {} });
    }

    for (const ch of hint.key) {
      cells.push({ ch, style: accentStyle });
    }

    cells.push({ ch: " ", style: {} });

    for (const ch of hint.label) {
      cells.push({ ch, style: {} });
    }
  });

  return cells;
}

function truncateCells(
  cells: Array<{ ch: string; style: CellStyle }>,
  width: number
): Array<{ ch: string; style: CellStyle }> {
  if (cells.length <= width) {
    return cells;
  }

  if (width <= 3) {
    return Array.from({ length: Math.max(0, width) }, () => ({ ch: ".", style: {} }));
  }

  return [
    ...cells.slice(0, width - 3),
    { ch: ".", style: {} },
    { ch: ".", style: {} },
    { ch: ".", style: {} }
  ];
}

function getAccentStyle(): CellStyle {
  return getTheme() === light ? { fg: "#006699", bold: true } : { fg: "cyan", bold: true };
}
