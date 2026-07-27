import type { ExplorerEvent } from "./events.js";
import type { Action, ActionContext, DetailItem, ExplorerState, Row, Tone } from "./state.js";

export type ActionSource = "row" | "detail" | "both";
type ExplorerKeypressEvent = Extract<ExplorerEvent, { type: "key" }>["key"];

export type ActionRuntimeHandles = {
  refresh: () => Promise<void>;
  reloadDetail: (rowId?: string) => void;
  suspendAnd: <T>(fn: () => Promise<T>) => Promise<T>;
  openModal: (content: { title: string; content: string }) => void;
  toast: (msg: string, tone?: Tone) => void;
  confirm: ActionContext<unknown>["confirm"];
  promptText: ActionContext<unknown>["promptText"];
  exit: (after?: () => void | Promise<void>) => void;
};

export function resolveAction<R>(
  state: ExplorerState,
  keyEvent: ExplorerKeypressEvent
): Action<R> | null {
  const target = state.bindings.resolve(keyEvent);
  if (target?.type !== "action") {
    return null;
  }

  const actionState = state.actionState.get(target.id);
  if (
    actionState?.available !== true ||
    actionState.running === true ||
    actionState.action === undefined
  ) {
    return null;
  }

  return actionState.action as Action<R>;
}

export function buildActionContext<R>(
  state: ExplorerState,
  _action: Action<R>,
  source: ActionSource,
  runtimeHandles: ActionRuntimeHandles,
  rowsOverride?: Row[]
): ActionContext<R> {
  const detailActive = source === "both" && state.focused === "detail";
  const row = rowsOverride?.[0] ??
    (detailActive ? currentDetailRow(state) : currentRow(state)) ?? { id: "", title: "" };
  const panes = runtimePanes(state);

  return {
    row,
    rows: rowsOverride ?? selectedRows(state, row),
    item: source === "detail" || detailActive ? currentDetailItem(state) : undefined,
    filter: state.filter,
    refresh: runtimeHandles.refresh,
    reloadDetail: runtimeHandles.reloadDetail,
    suspendAnd: runtimeHandles.suspendAnd,
    openModal: runtimeHandles.openModal,
    toast: runtimeHandles.toast,
    confirm: runtimeHandles.confirm,
    promptText: runtimeHandles.promptText,
    exit: runtimeHandles.exit,
    activePane: state.focused === "detail" ? panes[1] : panes[0],
    inactivePane: state.focused === "detail" ? panes[0] : panes[1]
  };
}

function currentRow(state: ExplorerState): Row | undefined {
  return state.rows[state.filtered[state.cursor] ?? -1];
}

function currentDetailItem(state: ExplorerState): DetailItem | undefined {
  return state.detail.items?.[state.detail.cursor];
}

function currentDetailRow(state: ExplorerState): Row | undefined {
  const item = currentDetailItem(state);
  return item === undefined
    ? undefined
    : { id: item.id, title: item.title ?? item.id, subtitle: item.subtitle, badge: item.badge };
}

function selectedRows(state: ExplorerState, fallback: Row): Row[] {
  if (!state.multiSelect || state.selected.size === 0) {
    return fallback.id === "" ? [] : [fallback];
  }

  const source =
    state.focused === "detail"
      ? (state.detail.items ?? []).map((item) => ({
          id: item.id,
          title: item.title ?? item.id,
          subtitle: item.subtitle,
          badge: item.badge
        }))
      : state.rows;
  return source.filter((row) => state.selected.has(row.id));
}

function runtimePanes(
  state: ExplorerState
): [import("./state.js").PaneRuntimeState, import("./state.js").PaneRuntimeState] {
  const definitions = state.paneDefinitions;
  return [
    {
      id: definitions[0]?.id ?? "list",
      title: definitions[0]?.title ?? state.title,
      rows: state.rows,
      cursor: state.cursor,
      selected: state.selected,
      filter: state.filter
    },
    {
      id: definitions[1]?.id ?? "detail",
      title: definitions[1]?.title ?? "Preview",
      rows: (state.detail.items ?? []).map((item) => ({
        id: item.id,
        title: item.title ?? item.id,
        subtitle: item.subtitle,
        badge: item.badge
      })),
      cursor: state.detail.cursor,
      selected: state.selected,
      filter: ""
    }
  ];
}
