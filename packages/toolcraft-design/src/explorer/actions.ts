import type { ExplorerEvent } from "./events.js";
import type { Action, ActionContext, DetailItem, ExplorerState, Row, Tone } from "./state.js";

export type ActionSource = "row" | "detail";
type ExplorerKeypressEvent = Extract<ExplorerEvent, { type: "key" }>["key"];

export type ActionRuntimeHandles = {
  refresh: () => Promise<void>;
  reloadDetail: (rowId?: string) => void;
  suspendAnd: <T>(fn: () => Promise<T>) => Promise<T>;
  openModal: (content: { title: string; content: string }) => void;
  toast: (msg: string, tone?: Tone) => void;
  confirm: (prompt: string) => Promise<boolean>;
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
  const row = rowsOverride?.[0] ?? currentRow(state) ?? { id: "", title: "" };

  return {
    row,
    rows: rowsOverride ?? selectedRows(state, row),
    item: source === "detail" ? currentDetailItem(state) : undefined,
    filter: state.filter,
    refresh: runtimeHandles.refresh,
    reloadDetail: runtimeHandles.reloadDetail,
    suspendAnd: runtimeHandles.suspendAnd,
    openModal: runtimeHandles.openModal,
    toast: runtimeHandles.toast,
    confirm: runtimeHandles.confirm,
    exit: runtimeHandles.exit
  };
}

function currentRow(state: ExplorerState): Row | undefined {
  return state.rows[state.filtered[state.cursor] ?? -1];
}

function currentDetailItem(state: ExplorerState): DetailItem | undefined {
  return state.detail.items?.[state.detail.cursor];
}

function selectedRows(state: ExplorerState, fallback: Row): Row[] {
  if (!state.multiSelect || state.selected.size === 0) {
    return fallback.id === "" ? [] : [fallback];
  }

  return state.rows.filter((row) => state.selected.has(row.id));
}
