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
}

export interface Detail<R> {
  items: (row: Row, ctx: DetailCtx) => Promise<DetailItem[]>;
  actions?: Action<R>[];      // run against the focused detail item
}

export interface DetailCtx { width: number; height: number; signal: AbortSignal; row: Row }

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
  suspendAnd: <T>(fn: () => Promise<T>) => Promise<T>;
  toast: (msg: string, tone?: Tone) => void;
  confirm: (prompt: string) => Promise<boolean>;
  exit: (after?: () => void | Promise<void>) => void;
}

export interface ExplorerConfig<R> {
  title: string;
  rows: () => Promise<Row[]>;
  detail: Detail<R>;
  actions: Action<R>[];
  reorder?: { onReorder: (orderedIds: string[]) => void | Promise<void> };
  multiSelect?: boolean;
  keybindOverrides?: Record<string, string | string[]>;
  emptyHint?: string;
  initialFilter?: string;
}
