import type { ScreenSurface as ScreenBuffer } from "../../screen/screen.js";
import { prepareDetailContent, type PreparedDetailContent } from "../detail-content.js";
import { paneBodyRect, type ExplorerLayout, type Rect } from "../layout.js";
import type { DetailItem, ExplorerState, Row } from "../state.js";
import { getExplorerStyles } from "../theme.js";
import { drawPaneFrame } from "./pane.js";
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
  const pane = state.paneDefinitions[1];
  const title = pane?.titleForRow?.(row ?? undefined) ?? pane?.title ?? "Preview";

  const { start, max } = renderDetailBody(state, screen, paneBodyRect(rect), row);

  drawPaneFrame(
    screen,
    rect,
    title,
    state.focused === "detail" ? styles.borderFocused : styles.border,
    { focused: state.focused === "detail", indicator: scrollIndicator(state, start, max) }
  );
}

function renderDetailBody(
  state: ExplorerState,
  screen: ScreenBuffer,
  rect: Rect,
  row: Row | null
): { start: number; max: number } {
  const styles = getExplorerStyles();
  const items = state.detail.items;

  if (rect.width <= 0 || rect.height <= 0) {
    return { start: 0, max: 0 };
  }

  if (items === null) {
    writeLine(screen, rect, 0, row === null ? state.emptyHint : "Loading detail...", styles.muted);
    return { start: 0, max: 0 };
  }

  if (items.length === 0) {
    writeLine(screen, rect, 0, state.emptyHint, styles.muted);
    return { start: 0, max: 0 };
  }

  if (items.length === 1 && items[0]?.title === undefined) {
    const content = prepareDetailContent(renderItem(items[0]!, rect, row), rect.width);
    return renderBlob(screen, rect, content.lines, state.detail.scroll);
  }

  return renderListMode(state, screen, rect, items, row);
}

function renderListMode(
  state: ExplorerState,
  screen: ScreenBuffer,
  rect: Rect,
  items: DetailItem[],
  row: Row | null
): { start: number; max: number } {
  const styles = getExplorerStyles();
  let y = 0;

  const max = Math.max(0, items.length - 1);
  const start = clamp(state.detail.scroll, 0, max);
  for (let index = start; index < items.length && y < rect.height; index += 1) {
    const item = items[index]!;
    const cursor = index === state.detail.cursor;
    const title = item.title ?? item.id;
    const selected = state.multiSelect && state.selected.has(item.id);
    const prefix = `${selected ? "*" : " "}${cursor ? "▌" : " "} `;
    const badge = item.badge ? ` ${item.badge.text}` : "";
    writeLine(
      screen,
      rect,
      y,
      `${prefix}${title}${badge}`,
      cursor ? styles.borderFocused : styles.accent
    );
    y += 1;

    if (item.subtitle && y < rect.height) {
      writeLine(screen, rect, y, `  ${item.subtitle}`, styles.muted);
      y += 1;
    }

    const content = prepareDetailContent(renderItem(item, rect, row), rect.width);
    for (const line of content.text.split("\n")) {
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
  return { start, max };
}

function renderBlob(screen: ScreenBuffer, rect: Rect, allLines: PreparedDetailContent["lines"], scroll: number): { start: number; max: number } {
  const max = Math.max(0, allLines.length - rect.height);
  const start = clamp(scroll, 0, max);
  const lines = allLines.slice(start);
  for (let row = 0; row < rect.height; row += 1) {
    let x = rect.x;
    for (const cell of lines[row] ?? []) {
      if (x + cell.width > rect.x + rect.width) break;
      screen.put(x, rect.y + row, cell.ch, cell.style);
      x += cell.width;
    }
  }
  return { start, max };
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

function scrollIndicator(state: ExplorerState, start: number, max: number): string {
  if (state.detail.loading) return "⠋";
  return `${max === 0 ? 0 : Math.round((start / max) * 100)}%`;
}
