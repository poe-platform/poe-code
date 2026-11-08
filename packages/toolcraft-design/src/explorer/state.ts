import { resolveBindings, type ResolvedBindings } from "./keymap.js";

export type Tone = "success" | "warning" | "error" | "info" | "muted";

export interface ConfirmPromptOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface Row {
  id: string;
  title: string;
  subtitle?: string;
  badge?: { text: string; tone?: Tone };
  group?: string; // grouped rendering; rows with same group cluster under a header
}

export interface DetailItem {
  id: string;
  title?: string; // absent => item fills pane with no cursor / no selection chrome
  subtitle?: string;
  badge?: { text: string; tone?: Tone };
  render: (ctx: DetailCtx) => string | Promise<string>;
  renderedContent?: string;
}

export interface Detail<R> {
  items: (row: Row, ctx: DetailCtx) => Promise<DetailItem[]>;
  actions?: Action<R>[]; // run against the focused detail item
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
  label: string | (() => string); // function form re-evaluated when state changes
  key?: string | string[];
  accelerator?: string;
  predicate?: (ctx: ActionContext<R>) => boolean;
  visible?: (row: Row) => boolean;
  handler: (ctx: ActionContext<R>) => void | Promise<void>;
  destructive?: boolean;
  primary?: boolean; // bound to Enter
  showInFooter?: boolean; // default true
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface ActionContext<R> {
  row: Row; // currently highlighted left-pane row
  rows: Row[]; // multi-select; falls back to [row] if no selection
  item?: DetailItem; // populated for actions declared under detail.actions
  filter: string;
  refresh: () => Promise<void>;
  /** Re-run detail.items for the focused row and repaint the preview pane. */
  reloadDetail: () => void;
  suspendAnd: <T>(fn: () => Promise<T>) => Promise<T>;
  openModal: (content: { title: string; content: string }) => void;
  toast: (msg: string, tone?: Tone) => void;
  confirm: (prompt: string | ConfirmPromptOptions) => Promise<boolean>;
  promptText: (options: {
    title: string;
    label: string;
    initialValue?: string;
    placeholder?: string;
  }) => Promise<string | null>;
  exit: (after?: () => void | Promise<void>) => void;
  activePane?: PaneRuntimeState;
  inactivePane?: PaneRuntimeState;
}

export interface ListPaneConfig {
  id: string;
  kind: "list";
  title: string;
  rows: () => Promise<Row[]>;
  emptyHint?: string;
  multiSelect?: boolean;
}

export interface DetailPaneConfig {
  id: string;
  kind: "detail";
  title: string;
  titleForRow?: (row: Row | undefined) => string;
  render: (row: Row | undefined, ctx: DetailCtx) => string | Promise<string>;
}

export type PaneConfig = ListPaneConfig | DetailPaneConfig;
export interface PaneRuntimeState {
  id: string;
  title: string;
  rows: Row[];
  cursor: number;
  selected: Set<string>;
  filter: string;
}

export interface ReorderContext {
  movedId: string;
  refresh: () => Promise<void>;
  toast: (msg: string, tone?: Tone) => void;
}

export interface ExplorerConfig<R> {
  title: string;
  panes?: PaneConfig[];
  rows?: () => Promise<Row[]>;
  refresh?: () => void | Promise<void>;
  detail?: Detail<R>;
  actions: Action<R>[];
  reorder?: { onReorder: (orderedIds: string[], ctx?: ReorderContext) => void | Promise<void> };
  multiSelect?: boolean;
  keybindOverrides?: Record<string, string | string[]>;
  emptyHint?: string;
  initialFilter?: string;
  /** Synchronous first paint rows; still refreshed via `rows()` after start. */
  initialRows?: Row[];
  /** Disable terminal mouse reporting when native text selection is more useful than wheel input. */
  mouse?: boolean;
}

export type NormalizedExplorerConfig<R> = ExplorerConfig<R> & {
  rows: () => Promise<Row[]>;
  detail: Detail<R>;
};

export function normalizeExplorerConfig<R>(config: ExplorerConfig<R>): NormalizedExplorerConfig<R> {
  if (config.panes === undefined) {
    if (config.rows === undefined || config.detail === undefined)
      throw new Error("Explorer requires panes");
    return config as NormalizedExplorerConfig<R>;
  }
  if (config.panes.length < 1 || config.panes.length > 3)
    throw new Error("Explorer requires 1 to 3 panes");
  const list = config.panes.find((pane): pane is ListPaneConfig => pane.kind === "list");
  if (list === undefined) throw new Error("Explorer requires a list pane");
  const companion = config.panes.find((pane) => pane !== list);
  const detail: Detail<R> =
    companion?.kind === "detail"
      ? {
          items: async (row, ctx) => {
            const content = await companion.render(row, ctx);
            if (ctx.signal.aborted) return [];
            return [{ id: row.id, render: () => content, renderedContent: content }];
          }
        }
      : companion?.kind === "list"
        ? {
            items: async () =>
              (await companion.rows()).map((row) => ({ ...row, render: () => "" })),
            actions: config.actions
          }
        : { items: async () => [] };
  return {
    ...config,
    rows: list.rows,
    detail,
    multiSelect: list.multiSelect ?? config.multiSelect,
    emptyHint: list.emptyHint ?? config.emptyHint
  };
}

export const REGION_HEADER = 1 << 0;
export const REGION_LIST = 1 << 1;
export const REGION_DETAIL = 1 << 2;
export const REGION_FOOTER = 1 << 3;
export const REGION_MODAL = 1 << 4;
export const REGION_TOAST = 1 << 5;
export const REGION_ALL =
  REGION_HEADER | REGION_LIST | REGION_DETAIL | REGION_FOOTER | REGION_MODAL | REGION_TOAST;

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
  rowsLoading: boolean;
  filtered: number[];
  matchPositions: Map<number, number[]>;
  cursor: number;
  filter: string;
  filterFocused: boolean;
  focused: "list" | "detail";
  detail: {
    rowId: string | null;
    items: DetailItem[] | null;
    allItems?: DetailItem[] | null;
    filter?: string;
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
    | {
        kind: "confirm";
        title: string;
        message: string;
        confirmLabel: string;
        cancelLabel: string;
        destructive: boolean;
        resolver: (ok: boolean) => void;
        action?: Action<unknown>;
        rows?: Row[];
      }
    | {
        kind: "input";
        title: string;
        label: string;
        value: string;
        placeholder?: string;
        resolver: (value: string | null) => void;
      }
    | { kind: "palette"; query: string; cursor: number }
    | { kind: "content"; title: string; content: string; scroll: number };
  toast: { message: string; tone: Tone; expiresAt: number } | null;
  dirty: Dirty;
  size: ExplorerSize;
  layout: ExplorerLayoutMode;
  bindings: ResolvedBindings;
  actionState: Map<string, ActionStateEntry>;
  suspended: boolean;
  paneDefinitions: Array<{
    id: string;
    title: string;
    kind: "list" | "detail";
    titleForRow?: (row: Row | undefined) => string;
  }>;
}

export interface ActionStateEntry {
  available: boolean;
  label: string;
  running?: boolean;
  action?: Action<unknown>;
  source?: "row" | "detail" | "both";
}

export function createInitialState<R>(
  config: ExplorerConfig<R>,
  size: ExplorerSize
): ExplorerState {
  const normalizedConfig = normalizeExplorerConfig(config);
  const normalizedSize = {
    cols: normalizeSize(size.cols),
    rows: normalizeSize(size.rows)
  };
  const multiSelect = normalizedConfig.multiSelect ?? true;

  const initialRows = normalizedConfig.initialRows ?? [];
  const initialFilter = normalizedConfig.initialFilter ?? "";
  // Defer filtering to first rowsLoaded when empty; seed list immediately when provided.
  return {
    title: normalizedConfig.title,
    emptyHint: normalizedConfig.emptyHint ?? "No detail",
    rows: initialRows,
    rowsLoading: true,
    filtered: initialRows.map((_, index) => index),
    matchPositions: new Map(),
    cursor: 0,
    filter: initialFilter,
    filterFocused: false,
    focused: "list",
    detail: {
      rowId: initialRows[0]?.id ?? null,
      items: null,
      allItems: null,
      filter: "",
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
    layout: resolveExplorerLayoutMode(normalizedSize.cols, normalizedSize.rows),
    bindings: resolveBindings(normalizedConfig),
    actionState: createInitialActionState(normalizedConfig),
    suspended: false,
    paneDefinitions: normalizedConfig.panes?.map(({ id, title, kind, ...pane }) => ({
      id,
      title,
      kind,
      ...(kind === "detail" && "titleForRow" in pane ? { titleForRow: pane.titleForRow } : {})
    })) ?? [
      { id: "list", title: normalizedConfig.title, kind: "list" },
      { id: "detail", title: "Preview", kind: "detail" }
    ]
  };
}

function createInitialActionState<R>(config: ExplorerConfig<R>): Map<string, ActionStateEntry> {
  const state = new Map<string, ActionStateEntry>();

  for (const [source, actions] of [
    ["row", config.actions],
    ["detail", config.detail?.actions ?? []]
  ] as const) {
    for (const action of actions) {
      if (state.has(action.id)) {
        const isSharedListAction =
          config.panes?.some((pane) => pane.kind === "list" && pane !== config.panes?.[0]) === true;
        if (!isSharedListAction) throw new Error(`Duplicate explorer action id: ${action.id}`);
        const existing = state.get(action.id)!;
        state.set(action.id, { ...existing, source: "both" });
        continue;
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

export function resolveExplorerLayoutMode(cols: number, rows = 24): ExplorerLayoutMode {
  if (cols < 60 || rows < 8) {
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
