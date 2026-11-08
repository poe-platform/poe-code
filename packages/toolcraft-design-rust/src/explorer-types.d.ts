import type {ResolvedBindings} from "./explorer-keymap.js";

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
