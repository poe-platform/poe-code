import { resolveBindings, type ResolvedBindings } from "./keymap.js";

export type Tone = "success" | "warning" | "error" | "info" | "muted";

export interface Row {
  id: string;
  title: string;
  subtitle?: string;
  badge?: { text: string; tone?: Tone };
  group?: string;        // grouped rendering; rows with same group cluster under a header
}

export interface DetailItem {
  id: string;
  title?: string;        // absent => item fills pane with no cursor / no selection chrome
  subtitle?: string;
  badge?: { text: string; tone?: Tone };
  render: (ctx: DetailCtx) => string | Promise<string>;
  renderedContent?: string;
}

export interface Detail<R> {
  items: (row: Row, ctx: DetailCtx) => Promise<DetailItem[]>;
  actions?: Action<R>[];      // run against the focused detail item
}

export interface DetailCtx {
  width: number;
  height: number;
  signal: AbortSignal;
  row: Row;
  /** Re-run detail.items for the focused row and repaint the preview pane. */
  reloadDetail?: () => void;
}

export interface Action<R> {
  id: string;
  label: string | (() => string);            // function form re-evaluated when state changes
  key?: string | string[];
  predicate?: (ctx: ActionContext<R>) => boolean;
  handler: (ctx: ActionContext<R>) => void | Promise<void>;
  destructive?: boolean;
  primary?: boolean;                          // bound to Enter
  showInFooter?: boolean;                     // default true
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface ActionContext<R> {
  row: Row;                    // currently highlighted left-pane row
  rows: Row[];                 // multi-select; falls back to [row] if no selection
  item?: DetailItem;           // populated for actions declared under detail.actions
  filter: string;
  refresh: () => Promise<void>;
  /** Re-run detail.items for the focused row and repaint the preview pane. */
  reloadDetail: () => void;
  suspendAnd: <T>(fn: () => Promise<T>) => Promise<T>;
  openModal: (content: { title: string; content: string }) => void;
  toast: (msg: string, tone?: Tone) => void;
  confirm: (prompt: string) => Promise<boolean>;
  exit: (after?: () => void | Promise<void>) => void;
}

export interface ReorderContext {
  refresh: () => Promise<void>;
  toast: (msg: string, tone?: Tone) => void;
}

export interface ExplorerConfig<R> {
  title: string;
  rows: () => Promise<Row[]>;
  refresh?: () => Promise<void>;
  detail: Detail<R>;
  actions: Action<R>[];
  reorder?: { onReorder: (orderedIds: string[], ctx?: ReorderContext) => void | Promise<void> };
  multiSelect?: boolean;
  keybindOverrides?: Record<string, string | string[]>;
  emptyHint?: string;
  initialFilter?: string;
  /** Synchronous first paint rows; still refreshed via `rows()` after start. */
  initialRows?: Row[];
}

export const REGION_HEADER = 1 << 0;
export const REGION_LIST = 1 << 1;
export const REGION_DETAIL = 1 << 2;
export const REGION_FOOTER = 1 << 3;
export const REGION_MODAL = 1 << 4;
export const REGION_TOAST = 1 << 5;
export const REGION_ALL =
  REGION_HEADER |
  REGION_LIST |
  REGION_DETAIL |
  REGION_FOOTER |
  REGION_MODAL |
  REGION_TOAST;

export type Dirty = number;

export type ExplorerLayoutMode =
  | "wide"
  | "medium"
  | "narrow-vertical"
  | "narrow-list-only"
  | "too-narrow";

export interface ExplorerSize {
  cols: number;
  rows: number;
}

export interface ExplorerState {
  title: string;
  emptyHint: string;
  rows: Row[];
  filtered: number[];
  matchPositions: Map<number, number[]>;
  cursor: number;
  filter: string;
  filterFocused: boolean;
  focused: "list" | "detail";
  detail: {
    rowId: string | null;
    items: DetailItem[] | null;
    cursor: number;
    scroll: number;
    token: number;
    loading: boolean;
  };
  selected: Set<string>;
  multiSelect: boolean;
  modal:
    | null
    | { kind: "help" }
    | { kind: "confirm"; action: Action<unknown>; rows: Row[]; resolver: (ok: boolean) => void }
    | { kind: "palette"; query: string; cursor: number }
    | { kind: "content"; title: string; content: string; scroll: number };
  toast: { message: string; tone: Tone; expiresAt: number } | null;
  dirty: Dirty;
  size: ExplorerSize;
  layout: ExplorerLayoutMode;
  bindings: ResolvedBindings;
  actionState: Map<string, ActionStateEntry>;
}

export interface ActionStateEntry {
  available: boolean;
  label: string;
  running?: boolean;
  action?: Action<unknown>;
  source?: "row" | "detail";
}

export function createInitialState<R>(
  config: ExplorerConfig<R>,
  size: ExplorerSize
): ExplorerState {
  const normalizedSize = {
    cols: normalizeSize(size.cols),
    rows: normalizeSize(size.rows)
  };
  const multiSelect = config.multiSelect ?? true;

  const initialRows = config.initialRows ?? [];
  const initialFilter = config.initialFilter ?? "";
  // Defer filtering to first rowsLoaded when empty; seed list immediately when provided.
  return {
    title: config.title,
    emptyHint: config.emptyHint ?? "No detail",
    rows: initialRows,
    filtered: initialRows.map((_, index) => index),
    matchPositions: new Map(),
    cursor: 0,
    filter: initialFilter,
    filterFocused: false,
    focused: "list",
    detail: {
      rowId: initialRows[0]?.id ?? null,
      items: null,
      cursor: 0,
      scroll: 0,
      token: initialRows.length > 0 ? 1 : 0,
      loading: initialRows.length > 0
    },
    selected: new Set(),
    multiSelect,
    modal: null,
    toast: null,
    dirty: REGION_ALL,
    size: normalizedSize,
    layout: resolveExplorerLayoutMode(normalizedSize.cols),
    bindings: resolveBindings(config),
    actionState: createInitialActionState(config)
  };
}

function createInitialActionState<R>(
  config: ExplorerConfig<R>
): Map<string, ActionStateEntry> {
  const state = new Map<string, ActionStateEntry>();

  for (const [source, actions] of [["row", config.actions], ["detail", config.detail.actions ?? []]] as const) {
    for (const action of actions) {
      if (state.has(action.id)) {
        throw new Error(`Duplicate explorer action id: ${action.id}`);
      }

      state.set(action.id, {
        available: true,
        label: typeof action.label === "function" ? action.id : action.label,
        action: action as Action<unknown>,
        source
      });
    }
  }

  return state;
}

export function resolveExplorerLayoutMode(cols: number): ExplorerLayoutMode {
  if (cols < 40) {
    return "too-narrow";
  }

  if (cols < 80) {
    return "narrow-list-only";
  }

  if (cols < 100) {
    return "narrow-vertical";
  }

  if (cols < 120) {
    return "medium";
  }

  return "wide";
}

function normalizeSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}
