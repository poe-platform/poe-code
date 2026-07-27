import type { ScreenSurface as ScreenBuffer } from "../../screen/screen.js";
import { ansiToCells } from "../../screen/ansi-text.js";
import { renderMarkdown } from "../../terminal-markdown/index.js";
import type { ExplorerLayout, Rect } from "../layout.js";
import type { DetailItem, ExplorerState, Row } from "../state.js";
import { getExplorerStyles } from "../theme.js";
import { drawPaneFrame, paneBodyRect } from "./pane.js";
import { fitToWidth } from "./text.js";

const markdownCache = new Map<string, string>();

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

  if (layout.mode === "narrow-vertical") {
    drawPaneFrame(
      screen,
      rect,
      title,
      state.focused === "detail" ? styles.borderFocused : styles.border,
      { focused: state.focused === "detail", indicator: scrollIndicator(state) }
    );
    renderDetailBody(state, screen, paneBodyRect(rect), row);
    return;
  }

  drawPaneFrame(
    screen,
    rect,
    title,
    state.focused === "detail" ? styles.borderFocused : styles.border,
    { focused: state.focused === "detail", indicator: scrollIndicator(state) }
  );
  renderDetailBody(state, screen, paneBodyRect(rect), row);
}

function renderDetailBody(
  state: ExplorerState,
  screen: ScreenBuffer,
  rect: Rect,
  row: Row | null
): void {
  const styles = getExplorerStyles();
  const items = state.detail.items;

  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  if (items === null) {
    writeLine(screen, rect, 0, row === null ? state.emptyHint : "Loading detail...", styles.muted);
    return;
  }

  if (items.length === 0) {
    writeLine(screen, rect, 0, state.emptyHint, styles.muted);
    return;
  }

  if (items.length === 1 && items[0]?.title === undefined) {
    renderBlob(screen, rect, renderItemMarkdown(items[0]!, rect, row), state.detail.scroll);
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

    for (const line of renderItemMarkdown(item, rect, row).split("\n")) {
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
  const allLines: ReturnType<typeof ansiToCells>[] = [[]];
  for (const cell of ansiToCells(text)) {
    if (cell.ch === "\n") allLines.push([]);
    else allLines.at(-1)!.push(cell);
  }
  const start = clamp(scroll, 0, Math.max(0, allLines.length - rect.height));
  const lines = allLines.slice(start);
  for (let row = 0; row < rect.height; row += 1) {
    let x = rect.x;
    for (const cell of lines[row] ?? []) {
      if (x + cell.width > rect.x + rect.width) break;
      screen.put(x, rect.y + row, cell.ch, cell.style);
      x += cell.width;
    }
  }
}

function renderItemMarkdown(item: DetailItem, rect: Rect, row: Row | null): string {
  const content = renderItem(item, rect, row);
  if (content.trim().length === 0) {
    return "";
  }

  const width = Math.max(1, rect.width);
  const key = `${contentHash(content)}:${width}`;
  const cached = markdownCache.get(key);
  if (cached !== undefined) return cached;
  const rendered = renderMarkdown(content, { width }).trimEnd();
  markdownCache.set(key, rendered);
  return rendered;
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

function scrollIndicator(state: ExplorerState): string {
  if (state.detail.loading) return "⠋";
  const content = state.detail.items?.[state.detail.cursor]?.renderedContent ?? "";
  const total = Math.max(1, content.split("\n").length);
  return `${Math.min(100, Math.round((state.detail.scroll / Math.max(1, total - 1)) * 100))}%`;
}

function contentHash(content: string): number {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
