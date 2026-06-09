import { ScreenBuffer } from "../../dashboard/buffer.js";
import type { ExplorerLayout, Rect } from "../layout.js";
import type { DetailItem, ExplorerState, Row } from "../state.js";
import { getExplorerStyles } from "../theme.js";
import { fitToWidth } from "./text.js";

export function renderDetail(
  state: ExplorerState,
  screen: ScreenBuffer,
  layout: ExplorerLayout
): void {
  const rect = layout.detail;
  const styles = getExplorerStyles();
  screen.clearRect(rect);

  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  const row = state.rows.find((r) => r.id === state.detail.rowId) ?? null;

  if (layout.mode === "narrow-vertical") {
    screen.put(rect.x, rect.y, `├─ Detail ${"─".repeat(Math.max(0, rect.width - 11))}┤`, styles.border);
    renderDetailBody(state, screen, { ...rect, y: rect.y + 1, height: rect.height - 1 }, row);
    return;
  }

  screen.put(rect.x, rect.y, "│", styles.border);
  renderDetailBody(state, screen, { ...rect, x: rect.x + 1, width: rect.width - 1 }, row);
}

function renderDetailBody(
  state: ExplorerState,
  screen: ScreenBuffer,
  rect: Rect,
  row: Row | null
): void {
  const styles = getExplorerStyles();
  const items = state.detail.items;

  if (items === null) {
    writeLine(screen, rect, 0, state.detail.loading ? "Loading detail..." : state.emptyHint, styles.muted);
    return;
  }

  if (items.length === 0) {
    writeLine(screen, rect, 0, state.emptyHint, styles.muted);
    return;
  }

  if (items.length === 1 && items[0]?.title === undefined) {
    renderBlob(screen, rect, renderItem(items[0]!, rect, row), state.detail.scroll);
    return;
  }

  renderListMode(state, screen, rect, items, row);
}

function renderListMode(
  state: ExplorerState,
  screen: ScreenBuffer,
  rect: Rect,
  items: DetailItem[],
  row: Row | null
): void {
  const styles = getExplorerStyles();
  let y = 0;

  const start = clamp(state.detail.scroll, 0, Math.max(0, items.length - 1));
  for (let index = start; index < items.length && y < rect.height; index += 1) {
    const item = items[index]!;
    const cursor = index === state.detail.cursor;
    const title = item.title ?? item.id;
    const prefix = cursor ? "▌ " : "  ";
    const badge = item.badge ? ` ${item.badge.text}` : "";
    writeLine(screen, rect, y, `${prefix}${title}${badge}`, cursor ? styles.borderFocused : styles.accent);
    y += 1;

    if (item.subtitle && y < rect.height) {
      writeLine(screen, rect, y, `  ${item.subtitle}`, styles.muted);
      y += 1;
    }

    for (const line of renderItem(item, rect, row).split("\n")) {
      if (y >= rect.height) {
        break;
      }
      writeLine(screen, rect, y, `  ${line}`, {});
      y += 1;
    }

    if (y < rect.height) {
      y += 1;
    }
  }
}

function renderBlob(screen: ScreenBuffer, rect: Rect, text: string, scroll: number): void {
  const allLines = text.split("\n");
  const start = clamp(scroll, 0, Math.max(0, allLines.length - rect.height));
  const lines = allLines.slice(start);
  for (let row = 0; row < rect.height; row += 1) {
    writeLine(screen, rect, row, lines[row] ?? "");
  }
}

function renderItem(item: DetailItem, rect: Rect, row: Row | null): string {
  if (item.renderedContent !== undefined) {
    return item.renderedContent;
  }

  try {
    const rendered = item.render({
      width: rect.width,
      height: rect.height,
      row: row ?? { id: "", title: "" },
      signal: new AbortController().signal
    });
    return typeof rendered === "string" ? rendered : "Loading detail...";
  } catch (error) {
    return error instanceof Error ? `Error: ${error.message}` : "Error: detail failed";
  }
}

function writeLine(screen: ScreenBuffer, rect: Rect, row: number, text: string, style = {}): void {
  if (row < 0 || row >= rect.height) {
    return;
  }
  screen.put(rect.x, rect.y + row, fitToWidth(text, rect.width, rect.x), style);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
