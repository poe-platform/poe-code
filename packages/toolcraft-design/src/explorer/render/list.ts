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

  const lines = buildDisplayLines(state);
  const start = visibleStart(lines, bodyRect.height);
  let y = 0;

  for (let lineIndex = start; lineIndex < lines.length && y < bodyRect.height; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (line.kind === "group") {
      const hash = `group:${line.label}`;
      if (cache.get(y) !== hash) {
        writeLine(screen, bodyRect, y, formatGroupHeader(line.label, bodyRect), styles.muted);
        cache.set(y, hash);
      }
      y += 1;
      continue;
    }

    if (line.kind === "subtitle") {
      const subtitleHash = `subtitle:${line.row.id}:${line.text}`;
      if (cache.get(y) !== subtitleHash) {
        writeLine(screen, bodyRect, y, `  ${line.text}`, styles.muted);
        cache.set(y, subtitleHash);
      }
      y += 1;
      continue;
    }

    const rowIndex = line.rowIndex;
    if (y >= bodyRect.height) {
      break;
    }

    const row = line.row;
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
  }
}

type DisplayLine =
  | { kind: "group"; label: string }
  | { kind: "row"; rowIndex: number; row: Row; cursor: boolean }
  | { kind: "subtitle"; row: Row; text: string };

function buildDisplayLines(state: ExplorerState): DisplayLine[] {
  const lines: DisplayLine[] = [];
  let lastGroup: string | undefined;

  for (const rowIndex of state.filtered) {
    const row = state.rows[rowIndex];
    if (!row) {
      continue;
    }

    if (row.group && row.group !== lastGroup) {
      lines.push({ kind: "group", label: row.group });
      lastGroup = row.group;
    }

    lines.push({ kind: "row", rowIndex, row, cursor: rowIndex === state.filtered[state.cursor] });
    if (row.subtitle) {
      lines.push({ kind: "subtitle", row, text: row.subtitle });
    }
  }

  return lines;
}

function visibleStart(lines: DisplayLine[], height: number): number {
  if (height <= 0) {
    return 0;
  }

  const cursorLine = lines.findIndex((line) => line.kind === "row" && line.cursor);
  if (cursorLine < 0) {
    return 0;
  }

  return Math.max(0, Math.min(cursorLine, cursorLine - height + 1));
}

function formatGroupHeader(label: string, rect: Rect): string {
  const text = ` ${label} `;
  const labelWidth = cellWidth(text, rect.x);
  if (labelWidth >= rect.width) {
    return label;
  }

  return `${text}${"─".repeat(rect.width - labelWidth)}`;
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
