import { ScreenBuffer, cellToAnsi } from "../dashboard/buffer.js";
import { createTerminalDriver, type KeypressEvent, type TerminalDriver } from "../dashboard/terminal.js";
import type { CellStyle } from "../dashboard/types.js";
import type { Tone } from "./state.js";

export interface TwoPaneRow {
  id: string;
  title: string;
  subtitle?: string;
  badge?: { text: string; tone?: Tone };
}

export interface TwoPaneDefinition {
  id: string;
  title: string;
  rows: () => Promise<TwoPaneRow[]>;
  emptyHint?: string;
}

export interface TwoPaneActionContext<R> {
  activePane: TwoPanePaneState;
  inactivePane: TwoPanePaneState;
  row: TwoPaneRow;
  rows: TwoPaneRow[];
  refresh: () => Promise<void>;
  suspendAnd: <T>(fn: () => Promise<T>) => Promise<T>;
  toast: (message: string, tone?: Tone) => void;
  exit: (result?: R | null) => void;
}

export interface TwoPaneAction<R> {
  id: string;
  label: string;
  key: string | string[];
  handler: (ctx: TwoPaneActionContext<R>) => void | Promise<void>;
}

export interface TwoPaneExplorerConfig<R> {
  title: string;
  panes: [TwoPaneDefinition, TwoPaneDefinition];
  actions: TwoPaneAction<R>[];
  refresh?: () => void | Promise<void>;
}

export interface TwoPanePaneState {
  id: string;
  title: string;
  rows: TwoPaneRow[];
  cursor: number;
  selected: Set<string>;
  filter: string;
  emptyHint: string;
}

export interface TwoPaneExplorerState {
  title: string;
  panes: [TwoPanePaneState, TwoPanePaneState];
  activePaneIndex: 0 | 1;
  filterFocused: boolean;
  toast: { message: string; tone: Tone } | null;
  size: { cols: number; rows: number };
}

const TOAST_MS = 2500;

export async function runTwoPaneExplorer<R = void>(
  config: TwoPaneExplorerConfig<R>
): Promise<R | null> {
  if (process.stdout.isTTY !== true) {
    throw new Error("two-pane explorer requires a TTY");
  }

  return new TwoPaneExplorerRuntime(config, createTerminalDriver()).run();
}

export class TwoPaneExplorerRuntime<R> {
  private state: TwoPaneExplorerState;
  private unsubscribeKeypress: (() => void) | undefined;
  private unsubscribeResize: (() => void) | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private rowsRequestToken = 0;
  private settle:
    | { resolve: (value: R | null) => void; reject: (error: unknown) => void }
    | undefined;

  constructor(
    private readonly config: TwoPaneExplorerConfig<R>,
    private readonly driver: TerminalDriver
  ) {
    const size = normalizeSize(driver.getSize());
    this.state = {
      title: config.title,
      panes: [
        initialPaneState(config.panes[0]),
        initialPaneState(config.panes[1])
      ],
      activePaneIndex: 0,
      filterFocused: false,
      toast: null,
      size
    };
  }

  run(): Promise<R | null> {
    return new Promise<R | null>((resolve, reject) => {
      this.settle = { resolve, reject };
      try {
        this.startTerminal();
        this.render();
        this.loadRows().catch((error) => this.fail(error));
      } catch (error) {
        this.fail(error);
      }
    });
  }

  private startTerminal(): void {
    this.driver.enterRawMode();
    this.driver.enterAltScreen();
    this.driver.disableLineWrap();
    this.driver.hideCursor();
    this.unsubscribeKeypress = this.driver.onKeypress((key) => {
      this.dispatchKey(key);
    });
    this.unsubscribeResize = this.driver.onResize(() => {
      this.state = { ...this.state, size: normalizeSize(this.driver.getSize()) };
      this.render();
    });
  }

  private async loadRows(requestToken = ++this.rowsRequestToken): Promise<void> {
    const [leftRows, rightRows] = await Promise.all([
      this.config.panes[0].rows(),
      this.config.panes[1].rows()
    ]);
    if (requestToken !== this.rowsRequestToken) {
      return;
    }
    this.state = {
      ...this.state,
      panes: [
        rowsLoaded(this.state.panes[0], leftRows),
        rowsLoaded(this.state.panes[1], rightRows)
      ]
    };
    this.render();
  }

  private async refresh(): Promise<void> {
    await this.config.refresh?.();
    await this.loadRows(++this.rowsRequestToken);
  }

  private dispatchKey(key: KeypressEvent): void {
    if (this.stopped) {
      return;
    }

    if (this.state.filterFocused) {
      this.dispatchFilterKey(key);
      return;
    }

    if (isQuitKey(key)) {
      this.exit(null);
      return;
    }
    if (key.name === "tab") {
      this.state = {
        ...this.state,
        activePaneIndex: this.state.activePaneIndex === 0 ? 1 : 0
      };
      this.render();
      return;
    }
    if (key.name === "up" || key.name === "down") {
      this.moveCursor(key.name === "up" ? -1 : 1);
      return;
    }
    if (key.name === "home") {
      this.setCursor(0);
      return;
    }
    if (key.name === "end") {
      this.setCursor(filteredRows(this.activePane()).length - 1);
      return;
    }
    if (key.ch === " ") {
      this.toggleSelection();
      return;
    }
    if (key.ch === "/") {
      this.state = {
        ...this.state,
        filterFocused: true,
        panes: updateActivePane(this.state, (pane) => ({ ...pane, filter: "", cursor: 0 }))
      };
      this.render();
      return;
    }

    const action = this.config.actions.find((candidate) => actionMatchesKey(candidate, key));
    if (action !== undefined) {
      this.runAction(action);
    }
  }

  private dispatchFilterKey(key: KeypressEvent): void {
    if (key.name === "escape" || key.name === "return") {
      this.state = { ...this.state, filterFocused: false };
      this.render();
      return;
    }
    if (key.name === "backspace") {
      this.state = {
        ...this.state,
        panes: updateActivePane(this.state, (pane) => ({
          ...pane,
          filter: Array.from(pane.filter).slice(0, -1).join(""),
          cursor: 0
        }))
      };
      this.render();
      return;
    }
    if (key.ch !== undefined && key.ch.length > 0 && key.ch !== "/") {
      this.state = {
        ...this.state,
        panes: updateActivePane(this.state, (pane) => ({
          ...pane,
          filter: `${pane.filter}${key.ch}`,
          cursor: 0
        }))
      };
      this.render();
    }
  }

  private moveCursor(delta: number): void {
    const pane = this.activePane();
    const rows = filteredRows(pane);
    if (rows.length === 0) {
      return;
    }
    this.setCursor(Math.max(0, Math.min(rows.length - 1, pane.cursor + delta)));
  }

  private setCursor(cursor: number): void {
    this.state = {
      ...this.state,
      panes: updateActivePane(this.state, (pane) => ({
        ...pane,
        cursor: Math.max(0, cursor)
      }))
    };
    this.render();
  }

  private toggleSelection(): void {
    const pane = this.activePane();
    const row = currentRow(pane);
    if (row === undefined) {
      return;
    }
    const selected = new Set(pane.selected);
    if (selected.has(row.id)) {
      selected.delete(row.id);
    } else {
      selected.add(row.id);
    }
    this.state = {
      ...this.state,
      panes: updateActivePane(this.state, (candidate) => ({ ...candidate, selected }))
    };
    this.render();
  }

  private runAction(action: TwoPaneAction<R>): void {
    const activePane = this.activePane();
    const inactivePane = this.inactivePane();
    const row = currentRow(activePane);
    if (row === undefined) {
      this.showToast("Select an item first", "warning");
      return;
    }
    const selectedRows = activePane.rows.filter((candidate) => activePane.selected.has(candidate.id));
    const context: TwoPaneActionContext<R> = {
      activePane,
      inactivePane,
      row,
      rows: selectedRows.length > 0 ? selectedRows : [row],
      refresh: async () => this.refresh(),
      suspendAnd: async (fn) => this.suspendAnd(fn),
      toast: (message, tone) => this.showToast(message, tone),
      exit: (result) => this.exit(result ?? null)
    };
    Promise.resolve()
      .then(() => action.handler(context))
      .catch((error) => {
        this.showToast(error instanceof Error ? error.message : "Action failed", "error");
      });
  }

  private async suspendAnd<T>(fn: () => Promise<T>): Promise<T> {
    this.driver.exitAltScreen();
    this.driver.enableLineWrap();
    this.driver.showCursor();
    this.driver.exitRawMode();
    try {
      return await fn();
    } finally {
      if (!this.stopped) {
        this.driver.enterRawMode();
        this.driver.enterAltScreen();
        this.driver.disableLineWrap();
        this.driver.hideCursor();
        this.state = { ...this.state, size: normalizeSize(this.driver.getSize()) };
        this.render();
      }
    }
  }

  private showToast(message: string, tone: Tone = "info"): void {
    if (this.toastTimer !== undefined) {
      clearTimeout(this.toastTimer);
    }
    this.state = { ...this.state, toast: { message, tone } };
    this.render();
    this.toastTimer = setTimeout(() => {
      this.state = { ...this.state, toast: null };
      this.render();
    }, TOAST_MS);
  }

  private activePane(): TwoPanePaneState {
    return this.state.panes[this.state.activePaneIndex];
  }

  private inactivePane(): TwoPanePaneState {
    return this.state.panes[this.state.activePaneIndex === 0 ? 1 : 0];
  }

  private render(): void {
    if (this.stopped) {
      return;
    }
    const size = normalizeSize(this.driver.getSize());
    if (size.cols !== this.state.size.cols || size.rows !== this.state.size.rows) {
      this.state = { ...this.state, size };
    }
    const next = new ScreenBuffer(this.state.size.cols, this.state.size.rows);
    renderTwoPaneExplorer(this.state, this.config.actions, next);
    this.driver.write(screenToAnsi(next));
  }

  private exit(result: R | null): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.unsubscribeKeypress?.();
    this.unsubscribeResize?.();
    if (this.toastTimer !== undefined) {
      clearTimeout(this.toastTimer);
    }
    this.driver.destroy();
    this.settle?.resolve(result);
  }

  private fail(error: unknown): void {
    if (!this.stopped) {
      this.stopped = true;
      this.driver.destroy();
    }
    this.settle?.reject(error);
  }
}

export function renderTwoPaneExplorer<R>(
  state: TwoPaneExplorerState,
  actions: TwoPaneAction<R>[],
  screen: ScreenBuffer
): void {
  screen.clear();
  if (state.size.cols < 60 || state.size.rows < 8) {
    screen.put(0, 0, fit(` ${state.title} `, state.size.cols), { bold: true });
    screen.put(0, 2, fit("Terminal is too small for two-pane view.", state.size.cols));
    screen.put(0, state.size.rows - 1, fit("q quit", state.size.cols), { dim: true });
    return;
  }

  const gap = 1;
  const paneWidth = Math.floor((state.size.cols - gap) / 2);
  const rightWidth = state.size.cols - paneWidth - gap;
  const paneHeight = Math.max(5, state.size.rows - 2);
  renderPane(screen, state.panes[0], {
    x: 0,
    y: 0,
    width: paneWidth,
    height: paneHeight,
    active: state.activePaneIndex === 0
  });
  renderPane(screen, state.panes[1], {
    x: paneWidth + gap,
    y: 0,
    width: rightWidth,
    height: paneHeight,
    active: state.activePaneIndex === 1
  });
  renderFooter(screen, state, actions, state.size.rows - 2);
  if (state.toast !== null) {
    screen.put(0, state.size.rows - 1, fit(` ${state.toast.message} `, state.size.cols), toneStyle(state.toast.tone));
  }
}

function renderPane(
  screen: ScreenBuffer,
  pane: TwoPanePaneState,
  layout: { x: number; y: number; width: number; height: number; active: boolean }
): void {
  const borderStyle: CellStyle = layout.active ? { bold: true, fg: "cyan" } : { dim: true };
  const title = `${layout.active ? ">" : " "} ${pane.title}`;
  screen.put(layout.x, layout.y, `+${fit(title, layout.width - 2, "-")}+`, borderStyle);
  for (let y = 1; y < layout.height - 1; y += 1) {
    screen.put(layout.x, layout.y + y, "|", borderStyle);
    screen.put(layout.x + layout.width - 1, layout.y + y, "|", borderStyle);
  }
  const filterLabel = pane.filter.length > 0 ? ` /${pane.filter}` : "";
  screen.put(
    layout.x,
    layout.y + layout.height - 1,
    `+${fit(`${pane.selected.size} selected${filterLabel}`, layout.width - 2, "-")}+`,
    borderStyle
  );

  const visibleRows = filteredRows(pane);
  const bodyHeight = layout.height - 2;
  if (visibleRows.length === 0) {
    screen.put(layout.x + 2, layout.y + 2, fit(pane.emptyHint, Math.max(0, layout.width - 4)), { dim: true });
    return;
  }

  const start = Math.max(0, Math.min(pane.cursor - Math.floor(bodyHeight / 2), visibleRows.length - bodyHeight));
  for (let index = 0; index < bodyHeight; index += 1) {
    const row = visibleRows[start + index];
    if (row === undefined) {
      continue;
    }
    const selected = pane.selected.has(row.id);
    const cursor = start + index === pane.cursor;
    const marker = selected ? "*" : " ";
    const pointer = cursor && layout.active ? ">" : " ";
    const badge = row.badge ? ` [${row.badge.text}]` : "";
    const subtitle = row.subtitle ? ` ${row.subtitle}` : "";
    const style: CellStyle = cursor && layout.active ? { inverse: true } : {};
    screen.put(
      layout.x + 1,
      layout.y + 1 + index,
      fit(`${pointer}${marker} ${row.title}${badge}${subtitle}`, layout.width - 2),
      style
    );
  }
}

function renderFooter<R>(
  screen: ScreenBuffer,
  state: TwoPaneExplorerState,
  actions: TwoPaneAction<R>[],
  y: number
): void {
  const actionHelp = actions.map((action) => `${firstKey(action.key)} ${action.label}`).join("   ");
  const filter = state.filterFocused ? "search: typing, enter done" : "/ search";
  const text = `tab pane   ${filter}   space select   ${actionHelp}   q quit`;
  screen.put(0, y, fit(text, state.size.cols), { dim: true });
}

function initialPaneState(definition: TwoPaneDefinition): TwoPanePaneState {
  return {
    id: definition.id,
    title: definition.title,
    rows: [],
    cursor: 0,
    selected: new Set(),
    filter: "",
    emptyHint: definition.emptyHint ?? "No items"
  };
}

function rowsLoaded(pane: TwoPanePaneState, rows: TwoPaneRow[]): TwoPanePaneState {
  const ids = new Set(rows.map((row) => row.id));
  return {
    ...pane,
    rows,
    selected: new Set([...pane.selected].filter((id) => ids.has(id))),
    cursor: Math.max(0, Math.min(pane.cursor, Math.max(0, filteredRows({ ...pane, rows }).length - 1)))
  };
}

function filteredRows(pane: TwoPanePaneState): TwoPaneRow[] {
  const query = pane.filter.trim().toLowerCase();
  if (query.length === 0) {
    return pane.rows;
  }
  return pane.rows.filter((row) => {
    const haystack = `${row.title} ${row.subtitle ?? ""} ${row.badge?.text ?? ""}`.toLowerCase();
    return haystack.includes(query);
  });
}

function currentRow(pane: TwoPanePaneState): TwoPaneRow | undefined {
  return filteredRows(pane)[pane.cursor];
}

function updateActivePane(
  state: TwoPaneExplorerState,
  update: (pane: TwoPanePaneState) => TwoPanePaneState
): [TwoPanePaneState, TwoPanePaneState] {
  return state.activePaneIndex === 0
    ? [update(state.panes[0]), state.panes[1]]
    : [state.panes[0], update(state.panes[1])];
}

function actionMatchesKey<R>(action: TwoPaneAction<R>, key: KeypressEvent): boolean {
  const keys = Array.isArray(action.key) ? action.key : [action.key];
  return keys.some((candidate) => key.ch === candidate || key.name === candidate);
}

function firstKey(key: string | string[]): string {
  return Array.isArray(key) ? key[0] ?? "" : key;
}

function isQuitKey(key: KeypressEvent): boolean {
  return key.ch === "q" || (key.name === "c" && key.ctrl);
}

function normalizeSize(size: { cols: number; rows: number }): { cols: number; rows: number } {
  return {
    cols: Math.max(0, Math.floor(size.cols)),
    rows: Math.max(0, Math.floor(size.rows))
  };
}

function fit(text: string, width: number, pad = " "): string {
  if (width <= 0) {
    return "";
  }
  const normalized = text.length > width ? text.slice(0, width) : text;
  return normalized.padEnd(width, pad);
}

function toneStyle(tone: Tone): CellStyle {
  if (tone === "success") {
    return { fg: "green", bold: true };
  }
  if (tone === "warning") {
    return { fg: "yellow", bold: true };
  }
  if (tone === "error") {
    return { fg: "red", bold: true };
  }
  return tone === "muted" ? { dim: true } : { fg: "cyan", bold: true };
}

function screenToAnsi(screen: ScreenBuffer): string {
  let output = "";
  for (let y = 0; y < screen.height; y += 1) {
    output += `\u001b[${y + 1};1H`;
    for (let x = 0; x < screen.width; x += 1) {
      const cell = screen.get(x, y);
      output += cellToAnsi(cell);
    }
  }
  return output;
}
