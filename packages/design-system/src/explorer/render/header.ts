import { ScreenBuffer } from "../../dashboard/buffer.js";
import type { ExplorerLayout } from "../layout.js";
import type { ExplorerState } from "../state.js";
import { getExplorerStyles, type ExplorerStyles } from "../theme.js";

type ExplorerCellStyle = ExplorerStyles["accent"];

export function renderHeader(
  state: ExplorerState,
  screen: ScreenBuffer,
  layout: ExplorerLayout
): void {
  const rect = layout.header;
  const styles = getExplorerStyles();
  screen.clearRect(rect);

  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  if (layout.mode === "too-narrow") {
    screen.put(0, 0, fit("Terminal too narrow", rect.width), styles.borderFocused);
    return;
  }

  drawTopBorder(screen, state.title, rect.width, styles.border);

  if (rect.height > 1) {
    const prompt = `${state.title.toLocaleLowerCase()}>`;
    const filter = state.filter.length > 0 ? ` ${state.filter}` : "";
    const count = `${state.filtered.length}/${state.rows.length}`;
    const selected = state.selected.size > 0 ? `  (${state.selected.size} selected)` : "";
    const spinner = state.detail.loading ? "  *" : "";
    const right = `${count}${selected}${spinner}`;
    screen.put(0, 1, "│", styles.border);
    screen.put(Math.max(0, rect.width - 1), 1, "│", styles.border);
    screen.put(2, 1, fit(`${prompt}${filter}`, Math.max(0, rect.width - right.length - 5)), styles.accent);
    screen.put(Math.max(2, rect.width - right.length - 2), 1, right, styles.muted);
  }

  if (rect.height > 2) {
    drawHorizontal(screen, 2, rect.width, styles.border);
  }
}

function drawTopBorder(screen: ScreenBuffer, title: string, width: number, style: ExplorerCellStyle): void {
  if (width === 1) {
    screen.put(0, 0, "┌", style);
    return;
  }

  const label = `─ ${title} `;
  const middle = label.length < width - 1
    ? `${label}${"─".repeat(width - 1 - label.length)}`
    : label.slice(0, Math.max(0, width - 1));
  screen.put(0, 0, `┌${middle.slice(0, Math.max(0, width - 2))}┐`, style);
}

function drawHorizontal(screen: ScreenBuffer, y: number, width: number, style: ExplorerCellStyle): void {
  if (width === 1) {
    screen.put(0, y, "├", style);
    return;
  }

  screen.put(0, y, `├${"─".repeat(Math.max(0, width - 2))}┤`, style);
}

function fit(text: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  if (text.length <= width) {
    return text;
  }
  return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}…`;
}
