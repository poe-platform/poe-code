import type { KeypressEvent } from "../dashboard/terminal.js";
import { buildActionContext, resolveAction, type ActionRuntimeHandles, type ActionSource } from "./actions.js";
import type { Effect, ExplorerEvent } from "./events.js";
import { filterRows } from "./filter.js";
import { computeExplorerLayout } from "./layout.js";
import {
  REGION_ALL,
  REGION_DETAIL,
  REGION_FOOTER,
  REGION_HEADER,
  REGION_LIST,
  REGION_MODAL,
  REGION_TOAST,
  type Action,
  type ActionStateEntry,
  type DetailItem,
  type Dirty,
  type ExplorerState,
  type Row
} from "./state.js";

type StepResult = { state: ExplorerState; effects: Effect[] };

const NO_EFFECTS: Effect[] = [];
const DEFAULT_ACTION_HANDLES: ActionRuntimeHandles = {
  refresh: async () => undefined,
  suspendAnd: async (fn) => fn(),
  toast: () => undefined,
  confirm: async () => false,
  exit: () => undefined
};

export function step(state: ExplorerState, event: ExplorerEvent): StepResult {
  switch (event.type) {
    case "key":
      return stepKey(state, event.key);
    case "resize":
      return resize(state, event.cols, event.rows);
    case "rowsLoaded":
      return rowsLoaded(state, event.rows);
    case "detailLoading":
      return detailLoading(state, event.rowId, event.token);
    case "detailLoaded":
      return detailLoaded(state, event.rowId, event.token, event.items);
    case "detailError":
      return detailError(state, event.rowId, event.token, event.error);
    case "actionResolved":
      return actionResolved(state, event.actionId);
    case "toastExpired":
      return expireToast(state);
    case "suspendResumed":
      return suspendResumed(state, event.emit);
    case "modalDismissed":
      return modalDismissed(state, event.result);
  }
}

function stepKey(state: ExplorerState, key: KeypressEvent): StepResult {
  const target = state.bindings.resolve(key);

  if (target?.type === "action") {
    const action = resolveAction(state, key);
    return action === null ? mark(state, 0) : dispatchAction(state, action, false);
  }

  if (target?.type === "builtin") {
    switch (target.id) {
      case "quit":
        return { state: markDirty(state, 0), effects: [{ type: "exit", result: null }] };
      case "filter":
        return mark(state, REGION_HEADER);
      case "help":
        return setModal(state, { kind: "help" });
      case "palette":
        return setModal(state, { kind: "palette", query: "", cursor: 0 });
      case "cursorUp":
        return moveCursor(state, -1);
      case "cursorDown":
        return moveCursor(state, 1);
      case "top":
        return setCursor(state, 0);
      case "bottom":
        return setCursor(state, state.filtered.length - 1);
      case "pageUp":
        return moveCursor(state, -pageSize(state));
      case "pageDown":
        return moveCursor(state, pageSize(state));
      case "focusNext":
        return focusNext(state);
      case "escape":
        return escape(state);
      case "confirm":
        return confirmKey(state);
      case "toggleSelect":
        return toggleSelect(state);
      case "selectAll":
        return selectAll(state);
      case "clearSelection":
        return clearSelection(state);
      case "detailScrollDown":
        return detailScroll(state, 1);
      case "detailScrollUp":
        return detailScroll(state, -1);
      case "extendSelectionUp":
        return extendSelection(state, -1);
      case "extendSelectionDown":
        return extendSelection(state, 1);
      case "reorderUp":
        return reorder(state, -1);
      case "reorderDown":
        return reorder(state, 1);
    }
  }

  if (state.modal?.kind === "confirm" && isConfirmNo(key)) {
    return modalDismissed(state, false);
  }

  if (state.modal?.kind === "confirm" && isConfirmYes(key)) {
    return modalDismissed(state, true);
  }

  if (state.modal?.kind === "palette") {
    return paletteInput(state, key);
  }

  if (isBackspace(key)) {
    return updateFilter(state, state.filter.slice(0, -1));
  }

  if (isPrintable(key)) {
    return updateFilter(state, `${state.filter}${key.ch}`);
  }

  return mark(state, 0);
}

function resize(state: ExplorerState, cols: number, rows: number): StepResult {
  const size = { cols: normalizeSize(cols), rows: normalizeSize(rows) };
  const layout = computeExplorerLayout(size).mode;

  if (state.size.cols === size.cols && state.size.rows === size.rows && state.layout === layout) {
    return mark(state, 0);
  }

  return {
    state: { ...state, size, layout, dirty: REGION_ALL },
    effects: NO_EFFECTS
  };
}

function rowsLoaded(state: ExplorerState, rows: Row[]): StepResult {
  const filtered = filterRows(state.filter, rows).map((match) => match.index);
  const cursor = clamp(state.cursor, 0, Math.max(0, filtered.length - 1));
  const next = {
    ...state,
    rows,
    filtered,
    cursor,
    selected: pruneSelection(state.selected, rows),
    detail: resetDetailForCursor(state, rows, filtered, cursor),
    modal: modalStillValid(state.modal, rows),
    actionState: recomputeActionState({ ...state, rows, filtered, cursor }),
    dirty: REGION_HEADER | REGION_LIST | REGION_DETAIL | REGION_FOOTER | REGION_MODAL
  };
  const effect = detailEffect(next);

  return { state: next, effects: effect === undefined ? NO_EFFECTS : [effect] };
}

function detailLoading(state: ExplorerState, rowId: string, token: number): StepResult {
  if (state.detail.rowId !== rowId || state.detail.token !== token) {
    return mark(state, 0);
  }

  if (state.detail.loading) {
    return mark(state, 0);
  }

  return {
    state: { ...state, detail: { ...state.detail, loading: true }, dirty: REGION_DETAIL },
    effects: NO_EFFECTS
  };
}

function detailLoaded(
  state: ExplorerState,
  rowId: string,
  token: number,
  items: DetailItem[]
): StepResult {
  if (state.detail.rowId !== rowId || state.detail.token !== token) {
    return mark(state, 0);
  }

  const detail = {
    ...state.detail,
    items,
    cursor: clamp(state.detail.cursor, 0, Math.max(0, items.length - 1)),
    scroll: 0,
    loading: false
  };

  return {
    state: {
      ...state,
      detail,
      actionState: recomputeActionState({ ...state, detail }),
      dirty: REGION_DETAIL | REGION_FOOTER
    },
    effects: NO_EFFECTS
  };
}

function detailError(state: ExplorerState, rowId: string, token: number, error: Error): StepResult {
  if (state.detail.rowId !== rowId || state.detail.token !== token) {
    return mark(state, 0);
  }

  return detailLoaded(state, rowId, token, [
    {
      id: `${rowId}:error`,
      title: "Error",
      badge: { text: "error", tone: "error" },
      render: () => error.message
    }
  ]);
}

function actionResolved(state: ExplorerState, actionId: string): StepResult {
  const current = state.actionState.get(actionId);
  if (current === undefined || current.running !== true) {
    return mark(state, 0);
  }

  const actionState = new Map(state.actionState);
  actionState.set(actionId, { ...current, running: false });
  return { state: { ...state, actionState, dirty: REGION_FOOTER }, effects: NO_EFFECTS };
}

function expireToast(state: ExplorerState): StepResult {
  if (state.toast === null) {
    return mark(state, 0);
  }

  return { state: { ...state, toast: null, dirty: REGION_TOAST }, effects: NO_EFFECTS };
}

function suspendResumed(state: ExplorerState, emit: ExplorerEvent): StepResult {
  const next = step(state, emit);
  return {
    state: { ...next.state, dirty: next.state.dirty | REGION_ALL },
    effects: next.effects
  };
}

function modalDismissed(state: ExplorerState, result: unknown): StepResult {
  const modal = state.modal;
  const closed = { ...state, modal: null, dirty: REGION_MODAL | REGION_FOOTER };

  if (modal?.kind !== "confirm" || result !== true) {
    return { state: closed, effects: NO_EFFECTS };
  }

  return dispatchAction(closed, modal.action, true, modal.rows);
}

function moveCursor(state: ExplorerState, delta: number): StepResult {
  return setCursor(state, state.cursor + delta);
}

function setCursor(state: ExplorerState, cursor: number): StepResult {
  const nextCursor = clamp(cursor, 0, Math.max(0, state.filtered.length - 1));
  if (nextCursor === state.cursor) {
    return mark(state, 0);
  }

  const detail = resetDetailForCursor(state, state.rows, state.filtered, nextCursor);
  const next = {
    ...state,
    cursor: nextCursor,
    detail,
    actionState: recomputeActionState({ ...state, cursor: nextCursor, detail }),
    dirty: REGION_LIST | REGION_DETAIL | REGION_FOOTER
  };
  const effect = detailEffect(next);

  return { state: next, effects: effect === undefined ? NO_EFFECTS : [effect] };
}

function updateFilter(state: ExplorerState, filter: string): StepResult {
  if (filter === state.filter) {
    return mark(state, 0);
  }

  const filtered = filterRows(filter, state.rows).map((match) => match.index);
  const cursor = clamp(0, 0, Math.max(0, filtered.length - 1));
  const detail = resetDetailForCursor({ ...state, filter }, state.rows, filtered, cursor);
  const next = {
    ...state,
    filter,
    filtered,
    cursor,
    detail,
    actionState: recomputeActionState({ ...state, filter, filtered, cursor, detail }),
    dirty: REGION_HEADER | REGION_LIST | REGION_DETAIL | REGION_FOOTER
  };
  const effect = detailEffect(next);

  return { state: next, effects: effect === undefined ? NO_EFFECTS : [effect] };
}

function focusNext(state: ExplorerState): StepResult {
  const focused = state.focused === "list" ? "detail" : "list";
  return {
    state: {
      ...state,
      focused,
      actionState: recomputeActionState({ ...state, focused }),
      dirty: REGION_LIST | REGION_DETAIL | REGION_FOOTER
    },
    effects: NO_EFFECTS
  };
}

function escape(state: ExplorerState): StepResult {
  if (state.filter.length > 0) {
    return updateFilter(state, "");
  }

  if (state.selected.size > 0) {
    return clearSelection(state);
  }

  if (state.modal !== null) {
    return modalDismissed(state, false);
  }

  return { state: markDirty(state, 0), effects: [{ type: "exit", result: null }] };
}

function confirmKey(state: ExplorerState): StepResult {
  if (state.modal?.kind === "confirm") {
    return modalDismissed(state, true);
  }

  return dispatchPrimary(state);
}

function toggleSelect(state: ExplorerState): StepResult {
  const row = currentRow(state);
  if (row === undefined) {
    return mark(state, 0);
  }

  const selected = new Set(state.selected);
  if (selected.has(row.id)) {
    selected.delete(row.id);
  } else {
    selected.add(row.id);
  }

  return selectionChanged(state, selected);
}

function selectAll(state: ExplorerState): StepResult {
  const selected = new Set(state.selected);
  for (const index of state.filtered) {
    const row = state.rows[index];
    if (row !== undefined) {
      selected.add(row.id);
    }
  }
  return selectionChanged(state, selected);
}

function clearSelection(state: ExplorerState): StepResult {
  if (state.selected.size === 0) {
    return mark(state, 0);
  }

  return selectionChanged(state, new Set());
}

function selectionChanged(state: ExplorerState, selected: Set<string>): StepResult {
  if (setsEqual(state.selected, selected)) {
    return mark(state, 0);
  }

  const next = {
    ...state,
    selected,
    actionState: recomputeActionState({ ...state, selected }),
    dirty: REGION_LIST | REGION_FOOTER
  };

  return { state: next, effects: NO_EFFECTS };
}

function detailScroll(state: ExplorerState, delta: number): StepResult {
  if (state.focused !== "detail") {
    return mark(state, 0);
  }

  const scroll = Math.max(0, state.detail.scroll + delta);
  if (scroll === state.detail.scroll) {
    return mark(state, 0);
  }

  return {
    state: { ...state, detail: { ...state.detail, scroll }, dirty: REGION_DETAIL },
    effects: NO_EFFECTS
  };
}

function extendSelection(state: ExplorerState, delta: number): StepResult {
  const moved = moveCursor(state, delta);
  const row = currentRow(moved.state);
  if (row === undefined) {
    return moved;
  }

  const selected = new Set(moved.state.selected);
  selected.add(row.id);
  return {
    state: {
      ...moved.state,
      selected,
      actionState: recomputeActionState({ ...moved.state, selected }),
      dirty: moved.state.dirty
    },
    effects: moved.effects
  };
}

function reorder(state: ExplorerState, delta: number): StepResult {
  if (state.filter !== "" || state.focused !== "list" || state.modal !== null) {
    return mark(state, 0);
  }

  const rowIndex = state.filtered[state.cursor];
  if (rowIndex === undefined) {
    return mark(state, 0);
  }

  const targetIndex = rowIndex + delta;
  if (targetIndex < 0 || targetIndex >= state.rows.length) {
    return mark(state, 0);
  }

  const rows = [...state.rows];
  const current = rows[rowIndex];
  const target = rows[targetIndex];
  if (current === undefined || target === undefined) {
    return mark(state, 0);
  }

  rows[rowIndex] = target;
  rows[targetIndex] = current;
  const filtered = rows.map((_, index) => index);
  const cursor = targetIndex;
  const next = {
    ...state,
    rows,
    filtered,
    cursor,
    actionState: recomputeActionState({ ...state, rows, filtered, cursor }),
    dirty: REGION_LIST | REGION_FOOTER
  };

  return { state: next, effects: [{ type: "persistOrder", orderedIds: rows.map((row) => row.id) }] };
}

function paletteInput(state: ExplorerState, key: KeypressEvent): StepResult {
  if (state.modal?.kind !== "palette") {
    return mark(state, 0);
  }

  if (isBackspace(key)) {
    return setModal(state, { ...state.modal, query: state.modal.query.slice(0, -1) });
  }

  if (isPrintable(key)) {
    return setModal(state, { ...state.modal, query: `${state.modal.query}${key.ch}` });
  }

  return mark(state, 0);
}

function dispatchPrimary(state: ExplorerState): StepResult {
  for (const [id, entry] of state.actionState.entries()) {
    if (entry.action?.primary === true) {
      return dispatchActionById(state, id, false);
    }
  }

  return mark(state, 0);
}

function dispatchActionById(state: ExplorerState, actionId: string, confirmed: boolean): StepResult {
  const entry = state.actionState.get(actionId);
  if (entry?.available !== true || entry.running === true || entry.action === undefined) {
    return mark(state, 0);
  }

  return dispatchAction(state, entry.action, confirmed);
}

function dispatchAction(
  state: ExplorerState,
  action: Action<unknown>,
  confirmed: boolean,
  modalRows?: Row[]
): StepResult {
  const rows = modalRows ?? selectedRows(state);
  if (rows.length === 0) {
    return mark(state, 0);
  }

  if (action.destructive === true && !confirmed) {
    return {
      state: {
        ...state,
        modal: { kind: "confirm", action, rows, resolver: () => undefined },
        dirty: REGION_MODAL | REGION_FOOTER
      },
      effects: NO_EFFECTS
    };
  }

  const actionState = new Map(state.actionState);
  const current = actionState.get(action.id);
  if (current !== undefined) {
    actionState.set(action.id, { ...current, running: true });
  }

  const next = { ...state, actionState, dirty: state.dirty | REGION_FOOTER };

  return {
    state: next,
    effects: [
      {
        type: "suspend",
        fn: async () => action.handler(buildActionContext(
          next,
          action,
          current?.source ?? actionSource(next, action),
          DEFAULT_ACTION_HANDLES,
          rows
        )),
        resumeWith: () => ({ type: "actionResolved", actionId: action.id })
      }
    ]
  };
}

function recomputeActionState(view: ExplorerState): ExplorerState["actionState"] {
  const next = new Map<string, ActionStateEntry>();

  for (const [id, entry] of view.actionState.entries()) {
    const { action } = entry;

    if (action === undefined) {
      next.set(id, entry);
      continue;
    }

    const ctx = buildActionContext(
      view,
      action,
      entry.source ?? actionSource(view, action),
      DEFAULT_ACTION_HANDLES
    );
    const available = action.predicate === undefined ? entry.available : action.predicate(ctx);
    const label = typeof action.label === "function" ? action.label() : action.label;
    next.set(id, { ...entry, available, label });
  }

  return next as ExplorerState["actionState"];
}

function resetDetailForCursor(
  state: ExplorerState,
  rows: Row[],
  filtered: number[],
  cursor: number
): ExplorerState["detail"] {
  const row = rows[filtered[cursor] ?? -1];
  if (row === undefined) {
    return {
      rowId: null,
      items: null,
      cursor: 0,
      scroll: 0,
      token: state.detail.token + 1,
      loading: false
    };
  }

  return {
    rowId: row.id,
    items: null,
    cursor: 0,
    scroll: 0,
    token: state.detail.token + 1,
    loading: false
  };
}

function detailEffect(state: ExplorerState): Effect | undefined {
  if (state.detail.rowId === null) {
    return undefined;
  }

  return { type: "renderDetail", rowId: state.detail.rowId, token: state.detail.token };
}

function currentRow(state: ExplorerState): Row | undefined {
  return state.rows[state.filtered[state.cursor] ?? -1];
}

function actionSource(state: ExplorerState, action: Action<unknown>): ActionSource {
  return state.actionState.get(action.id)?.source ?? "row";
}

function selectedRows(state: ExplorerState): Row[] {
  if (state.selected.size === 0) {
    const row = currentRow(state);
    return row === undefined ? [] : [row];
  }

  return state.rows.filter((row) => state.selected.has(row.id));
}

function setModal(state: ExplorerState, modal: ExplorerState["modal"]): StepResult {
  return { state: { ...state, modal, dirty: REGION_MODAL | REGION_FOOTER }, effects: NO_EFFECTS };
}

function mark(state: ExplorerState, dirty: Dirty): StepResult {
  return { state: markDirty(state, dirty), effects: NO_EFFECTS };
}

function markDirty(state: ExplorerState, dirty: Dirty): ExplorerState {
  return state.dirty === dirty ? state : { ...state, dirty };
}

function pageSize(state: ExplorerState): number {
  return Math.max(1, Math.floor(state.size.rows / 2));
}

function pruneSelection(selected: Set<string>, rows: Row[]): Set<string> {
  const ids = new Set(rows.map((row) => row.id));
  return new Set([...selected].filter((id) => ids.has(id)));
}

function modalStillValid(
  modal: ExplorerState["modal"],
  rows: Row[]
): ExplorerState["modal"] {
  if (modal?.kind !== "confirm") {
    return modal;
  }

  const ids = new Set(rows.map((row) => row.id));
  return modal.rows.every((row) => ids.has(row.id)) ? modal : null;
}

function normalizeSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function isPrintable(key: KeypressEvent): key is KeypressEvent & { ch: string } {
  return key.ch !== undefined && !key.ctrl && !key.meta;
}

function isBackspace(key: KeypressEvent): boolean {
  return key.name === "backspace" || key.name === "delete";
}

function isConfirmYes(key: KeypressEvent): boolean {
  return key.ch === "y" || key.ch === "Y";
}

function isConfirmNo(key: KeypressEvent): boolean {
  return key.ch === "n" || key.ch === "N";
}
