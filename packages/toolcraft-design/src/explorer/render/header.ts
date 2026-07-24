import type { ScreenSurface as ScreenBuffer } from "../../screen/screen.js";
import type { ExplorerLayout } from "../layout.js";
import type { ExplorerState } from "../state.js";
import { getExplorerStyles, type ExplorerStyles } from "../theme.js";
import { cellWidth, fitToWidth, padEndCells } from "./text.js";

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
    screen.put(0, 0, fitToWidth("Terminal too narrow", rect.width), styles.borderFocused);
    return;
  }

  drawTopBorder(screen, state.title, rect.width, styles.border);

  if (rect.height > 1) {
    const prompt = `${state.title.toLocaleLowerCase()}>`;
    const secondList = state.focused === "detail" && state.paneDefinitions[1]?.kind === "list";
    const activeFilter = secondList ? (state.detail.filter ?? "") : state.filter;
    const filter = activeFilter.length > 0 ? ` ${activeFilter}` : "";
    const count = secondList
      ? `${state.detail.items?.length ?? 0}/${state.detail.allItems?.length ?? state.detail.items?.length ?? 0}`
      : `${state.filtered.length}/${state.rows.length}`;
    const selected =
      state.multiSelect && state.selected.size > 0 ? `  (${state.selected.size} selected)` : "";
    const spinner = state.detail.loading ? "  *" : "";
    const right = `${count}${selected}${spinner}`;
    screen.put(0, 1, "│", styles.border);
    screen.put(Math.max(0, rect.width - 1), 1, "│", styles.border);
    const rightWidth = cellWidth(right);
    const promptWidth = Math.max(0, rect.width - rightWidth - 5);
    screen.put(2, 1, fitToWidth(`${prompt}${filter}`, promptWidth, 2), styles.accent);
    screen.put(Math.max(2, rect.width - rightWidth - 2), 1, right, styles.muted);
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

  const innerWidth = Math.max(0, width - 2);
  const label = fitToWidth(`─ ${title} `, innerWidth, 1);
  const middle = padEndCells(label, innerWidth, "─", 1);
  screen.put(0, 0, `┌${middle}┐`, style);
}

function drawHorizontal(screen: ScreenBuffer, y: number, width: number, style: ExplorerCellStyle): void {
  if (width === 1) {
    screen.put(0, y, "├", style);
    return;
  }

  screen.put(0, y, `├${"─".repeat(Math.max(0, width - 2))}┤`, style);
}
