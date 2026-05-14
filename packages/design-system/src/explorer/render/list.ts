import { ScreenBuffer } from "../../dashboard/buffer.js";
import { stripAnsi } from "../../internal/strip-ansi.js";
import { filterRows } from "../filter.js";
import type { ExplorerLayout, Rect } from "../layout.js";
import type { ExplorerState, Row } from "../state.js";
import { getExplorerStyles } from "../theme.js";

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

  const rectKey = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
  const cached = listLineCache.get(screen);
  const cache = cached?.rectKey === rectKey ? cached.lines : new Map<number, string>();
  listLineCache.set(screen, { rectKey, lines: cache });

  if (state.filtered.length === 0) {
    const hint = state.emptyHint;
    writeLine(screen, rect, Math.floor(rect.height / 2), center(hint, rect.width), styles.muted);
    cache.clear();
    return;
  }

  const matches = state.filter.length > 0 ? filterRows(state.filter, state.rows) : [];
  const matchByIndex = new Map(matches.map((match) => [match.index, match.positions]));
  let lastGroup: string | undefined;
  let y = 0;

  for (const rowIndex of state.filtered) {
    if (y >= rect.height) {
      break;
    }

    const row = state.rows[rowIndex];
    if (!row) {
      continue;
    }

    if (row.group && row.group !== lastGroup && y < rect.height) {
      const hash = `group:${row.group}`;
      if (cache.get(y) !== hash) {
        writeLine(screen, rect, y, row.group, styles.muted);
        cache.set(y, hash);
      }
      y += 1;
      lastGroup = row.group;
    }

    if (y >= rect.height) {
      break;
    }

    const selected = state.selected.has(row.id);
    const cursor = rowIndex === state.filtered[state.cursor];
    const positions = matchByIndex.get(rowIndex) ?? [];
    const hash = lineHash(row, selected, cursor, positions);

    if (cache.get(y) !== hash) {
      renderRow(screen, rect, y, row, { selected, cursor, focused: state.focused === "list", positions });
      cache.set(y, hash);
    }
    y += 1;

    if (row.subtitle && y < rect.height) {
      const subtitleHash = `${hash}:subtitle:${row.subtitle}`;
      if (cache.get(y) !== subtitleHash) {
        writeLine(screen, rect, y, `  ${row.subtitle}`, styles.muted);
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
  const badge = row.badge ? ` ${row.badge.text}` : "";
  const prefix = `${marker} ${cursor} `;
  const available = Math.max(0, rect.width - prefix.length - focus.length - badge.length);
  const title = stripAnsi(row.title).slice(0, available);
  let x = rect.x;
  const y = rect.y + rowY;

  screen.put(x, y, prefix, opts.cursor ? styles.accent : styles.muted);
  x += prefix.length;

  for (let index = 0; index < title.length; index += 1) {
    const style = opts.positions.includes(index) ? styles.matchHighlight : {};
    screen.put(x + index, y, title[index]!, style);
  }

  if (row.badge) {
    screen.put(rect.x + rect.width - badge.length - focus.length, y, badge, styles.tones[row.badge.tone ?? "muted"]);
  }

  if (focus) {
    screen.put(rect.x + rect.width - focus.length, y, focus, styles.borderFocused);
  }
}

function writeLine(
  screen: ScreenBuffer,
  rect: Rect,
  row: number,
  text: string,
  style = {}
): void {
  screen.put(rect.x, rect.y + row, fit(text, rect.width), style);
}

function lineHash(row: Row, selected: boolean, cursor: boolean, positions: number[]): string {
  return `${row.id}:${selected ? 1 : 0}:${cursor ? 1 : 0}:${positions.join(",")}`;
}

function center(text: string, width: number): string {
  return `${" ".repeat(Math.max(0, Math.floor((width - text.length) / 2)))}${text}`;
}

function fit(text: string, width: number): string {
  if (text.length <= width) {
    return text;
  }
  return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}…`;
}
