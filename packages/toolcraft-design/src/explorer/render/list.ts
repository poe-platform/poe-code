import { ScreenBuffer } from "../../dashboard/buffer.js";
import type { ExplorerLayout, Rect } from "../layout.js";
import type { ExplorerState, Row } from "../state.js";
import { getExplorerStyles } from "../theme.js";
import { drawPaneFrame, paneBodyRect } from "./pane.js";
import { cellWidth, centerCells, fitToWidth, splitGraphemeCells, stripAnsi } from "./text.js";

const listLineCache = new WeakMap<ScreenBuffer, { rectKey: string; lines: Map<number, string> }>();

export function renderList(
  state: ExplorerState,
  screen: ScreenBuffer,
  layout: ExplorerLayout
): void {
  const styles = getExplorerStyles();
  const rect = layout.list;
  screen.clearRect(rect);

  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  if (layout.mode === "too-narrow") {
    writeLine(screen, rect, 0, "Terminal too narrow", styles.muted);
    return;
  }

  drawPaneFrame(
    screen,
    rect,
    "Plans",
    state.focused === "list" ? styles.borderFocused : styles.border
  );
  const bodyRect = paneBodyRect(rect);
  if (bodyRect.width <= 0 || bodyRect.height <= 0) {
    return;
  }

  const rectKey = `${bodyRect.x}:${bodyRect.y}:${bodyRect.width}:${bodyRect.height}`;
  const cached = listLineCache.get(screen);
  const cache = cached?.rectKey === rectKey ? cached.lines : new Map<number, string>();
  listLineCache.set(screen, { rectKey, lines: cache });

  if (state.filtered.length === 0) {
    const hint = state.emptyHint;
    writeLine(
      screen,
      bodyRect,
      Math.floor(bodyRect.height / 2),
      centerCells(hint, bodyRect.width, bodyRect.x),
      styles.muted
    );
    cache.clear();
    return;
  }

  let lastGroup: string | undefined;
  let y = 0;

  for (const rowIndex of state.filtered) {
    if (y >= bodyRect.height) {
      break;
    }

    const row = state.rows[rowIndex];
    if (!row) {
      continue;
    }

    if (row.group && row.group !== lastGroup && y < bodyRect.height) {
      const hash = `group:${row.group}`;
      if (cache.get(y) !== hash) {
        writeLine(screen, bodyRect, y, row.group, styles.muted);
        cache.set(y, hash);
      }
      y += 1;
      lastGroup = row.group;
    }

    if (y >= bodyRect.height) {
      break;
    }

    const selected = state.multiSelect && state.selected.has(row.id);
    const cursor = rowIndex === state.filtered[state.cursor];
    const positions = state.matchPositions.get(rowIndex) ?? [];
    const hash = lineHash(row, selected, cursor, positions);

    if (cache.get(y) !== hash) {
      renderRow(screen, bodyRect, y, row, {
        selected,
        cursor,
        focused: state.focused === "list",
        positions
      });
      cache.set(y, hash);
    }
    y += 1;

    if (row.subtitle && y < bodyRect.height) {
      const subtitleHash = `${hash}:subtitle:${row.subtitle}`;
      if (cache.get(y) !== subtitleHash) {
        writeLine(screen, bodyRect, y, `  ${row.subtitle}`, styles.muted);
        cache.set(y, subtitleHash);
      }
      y += 1;
    }
  }
}

function renderRow(
  screen: ScreenBuffer,
  rect: Rect,
  rowY: number,
  row: Row,
  opts: { selected: boolean; cursor: boolean; focused: boolean; positions: number[] }
): void {
  const styles = getExplorerStyles();
  const marker = opts.selected ? "┃" : " ";
  const cursor = opts.cursor ? "●" : "◌";
  const focus = opts.cursor && opts.focused ? " ▌" : "";
  const prefix = `${marker} ${cursor} `;
  const prefixWidth = cellWidth(prefix, rect.x);
  const focusWidth = cellWidth(focus);
  const badge = row.badge
    ? fitToWidth(
        ` ${row.badge.text}`,
        Math.max(0, rect.width - prefixWidth - focusWidth),
        rect.x + prefixWidth
      )
    : "";
  const badgeWidth = cellWidth(badge);
  const available = Math.max(0, rect.width - prefixWidth - focusWidth - badgeWidth);
  const rawTitle = stripAnsi(row.title);
  const titleX = rect.x + prefixWidth;
  const title = fitToWidth(rawTitle, available, titleX);
  const titleWasTruncated = cellWidth(rawTitle, titleX) > available;
  const positions = new Set(opts.positions);
  let x = rect.x;
  const y = rect.y + rowY;

  screen.put(x, y, prefix, opts.cursor ? styles.accent : styles.muted);
  x += prefixWidth;

  for (const segment of splitGraphemeCells(title, x)) {
    const isTruncationMarker =
      titleWasTruncated && segment.end === title.length && segment.value === "…";
    const style =
      !isTruncationMarker && hasMatchPosition(segment.start, segment.end, positions)
        ? styles.matchHighlight
        : {};
    screen.put(x, y, segment.value, style);
    x += segment.width;
  }

  if (row.badge) {
    screen.put(
      rect.x + rect.width - badgeWidth - focusWidth,
      y,
      badge,
      styles.tones[row.badge.tone ?? "muted"]
    );
  }

  if (focus) {
    screen.put(rect.x + rect.width - focusWidth, y, focus, styles.borderFocused);
  }
}

function writeLine(screen: ScreenBuffer, rect: Rect, row: number, text: string, style = {}): void {
  screen.put(rect.x, rect.y + row, fitToWidth(text, rect.width, rect.x), style);
}

function lineHash(row: Row, selected: boolean, cursor: boolean, positions: number[]): string {
  return `${row.id}:${selected ? 1 : 0}:${cursor ? 1 : 0}:${positions.join(",")}`;
}

function hasMatchPosition(start: number, end: number, positions: Set<number>): boolean {
  for (let position = start; position < end; position += 1) {
    if (positions.has(position)) {
      return true;
    }
  }

  return false;
}
