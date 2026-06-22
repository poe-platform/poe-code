import {
  buildActionContext,
  resolveAction,
  type ActionRuntimeHandles,
  type ActionSource
} from "./actions.js";
import type { Effect, ExplorerEvent } from "./events.js";
import { type FilterMatch, filterRows } from "./filter.js";
import {
  REGION_ALL,
  REGION_DETAIL,
  REGION_FOOTER,
  REGION_HEADER,
  REGION_LIST,
  REGION_MODAL,
  type Action,
  type ActionStateEntry,
  type DetailItem,
  type Dirty,
  type ExplorerState,
  type Row,
  resolveExplorerLayoutMode
} from "./state.js";

type StepResult = { state: ExplorerState; effects: Effect[] };
type ExplorerKeypressEvent = Extract<ExplorerEvent, { type: "key" }>["key"];

const NO_EFFECTS: Effect[] = [];
const DEFAULT_ACTION_HANDLES: ActionRuntimeHandles = {
  refresh: async () => undefined,
  suspendAnd: async (fn) => fn(),
  toast: () => undefined,
  confirm: async () => false,
  exit: () => undefined
};

export function step(
  state: ExplorerState,
  event: ExplorerEvent,
  runtimeHandles: ActionRuntimeHandles = DEFAULT_ACTION_HANDLES
): StepResult {
  switch (event.type) {
    case "key":
      return stepKey(state, event.key, runtimeHandles);
    case "resize":
      return resize(state, event.cols, event.rows);
    case "rowsLoaded":
      return rowsLoaded(state, event.rows);
    case "detailLoading":
      return detailLoading(state, event.rowId, event.token);
    case "detailLoaded":
      return detailLoaded(state, event.rowId, event.token, event.items);
    case "detailItemRendered":
      return detailItemRendered(state, event.rowId, event.token, event.itemIndex, event.content);
    case "detailError":
      return detailError(state, event.rowId, event.token, event.error);
    case "actionResolved":
      return actionResolved(state, event.actionId);
    case "toastExpired":
      return expireToast(state);
    case "suspendResumed":
      return suspendResumed(state, event.emit, runtimeHandles);
    case "modalDismissed":
      return modalDismissed(state, event.result, runtimeHandles);
  }
}

function stepKey(
  state: ExplorerState,
  key: ExplorerKeypressEvent,
  runtimeHandles: ActionRuntimeHandles
): StepResult {
  const target = state.bindings.resolve(key);

  if (state.modal !== null) {
    return stepModalKey(state, key, target, runtimeHandles);
  }

  if (state.filterFocused) {
    return stepFilterKey(state, key, target, runtimeHandles);
  }

  if (target?.type === "action") {
    if (state.actionState.get(target.id)?.source === "detail" && state.focused !== "detail") {
      return mark(state, 0);
    }
    const action = resolveAction(state, key);
    return action === null ? mark(state, 0) : dispatchAction(state, action, false, runtimeHandles);
  }

  if (target?.type === "builtin") {
    switch (target.id) {
      case "quit":
        return { state: markDirty(state, 0), effects: [{ type: "exit", result: null }] };
      case "filter":
        return focusFilter(state);
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
        return escape(state, runtimeHandles);
      case "confirm":
        return confirmKey(state, runtimeHandles);
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

  if (isBackspace(key)) {
    return updateFilter(state, state.filter.slice(0, -1));
  }

  if (!state.multiSelect && isSelectionSpace(key)) {
    return mark(state, 0);
  }

  if (isPrintable(key)) {
    return updateFilter(state, `${state.filter}${key.ch}`);
  }

  return mark(state, 0);
}

function stepFilterKey(
  state: ExplorerState,
  key: ExplorerKeypressEvent,
  target: ReturnType<ExplorerState["bindings"]["resolve"]>,
  runtimeHandles: ActionRuntimeHandles
): StepResult {
  if (target?.type === "builtin" && target.id === "escape") {
    return escape(state, runtimeHandles);
  }

  if (target?.type === "builtin" && target.id === "confirm") {
    return {
      state: { ...state, filterFocused: false, dirty: REGION_HEADER | REGION_FOOTER },
      effects: NO_EFFECTS
    };
  }

  if (isBackspace(key)) {
    return updateFilter(state, state.filter.slice(0, -1));
  }

  if (isPrintable(key)) {
    return updateFilter(state, `${state.filter}${key.ch}`);
  }

  return mark(state, 0);
}

function stepModalKey(
  state: ExplorerState,
  key: ExplorerKeypressEvent,
  target: ReturnType<ExplorerState["bindings"]["resolve"]>,
  runtimeHandles: ActionRuntimeHandles
): StepResult {
  if (state.modal?.kind === "confirm") {
    if (target?.type === "builtin" && target.id === "escape") {
      return modalDismissed(state, false, runtimeHandles);
    }

    if (target?.type === "builtin" && target.id === "confirm") {
      return modalDismissed(state, true, runtimeHandles);
    }

    if (isConfirmNo(key)) {
      return modalDismissed(state, false, runtimeHandles);
    }

    if (isConfirmYes(key)) {
      return modalDismissed(state, true, runtimeHandles);
    }

    return mark(state, 0);
  }

  if (state.modal?.kind === "help") {
    if (target?.type === "builtin" && (target.id === "escape" || target.id === "help")) {
      return modalDismissed(state, false, runtimeHandles);
    }

    return mark(state, 0);
  }

  if (state.modal?.kind === "palette") {
    if (target?.type === "builtin") {
      switch (target.id) {
        case "escape":
          return modalDismissed(state, false, runtimeHandles);
        case "confirm":
          return dispatchPaletteAction(state, runtimeHandles);
        case "cursorUp":
          return movePaletteCursor(state, -1);
        case "cursorDown":
          return movePaletteCursor(state, 1);
      }
    }

    return paletteInput(state, key);
  }

  return mark(state, 0);
}

function resize(state: ExplorerState, cols: number, rows: number): StepResult {
  const size = { cols: normalizeSize(cols), rows: normalizeSize(rows) };
  const layout = resolveExplorerLayoutMode(size.cols);

  if (state.size.cols === size.cols && state.size.rows === size.rows && state.layout === layout) {
    return mark(state, 0);
  }

  return {
    state: clampDetailScroll({ ...state, size, layout, dirty: REGION_ALL }),
    effects: NO_EFFECTS
  };
}

function rowsLoaded(state: ExplorerState, rows: Row[]): StepResult {
  const rowIds = new Set<string>();
  for (const row of rows) {
    if (rowIds.has(row.id)) {
      throw new Error(`Duplicate explorer row id: ${row.id}`);
    }
    rowIds.add(row.id);
  }

  const matches = filterRows(state.filter, rows);
  const filtered = matches.map((match) => match.index);
  const matchPositions = createMatchPositions(matches);
  const cursor = clamp(state.cursor, 0, Math.max(0, filtered.length - 1));
  const selected = state.multiSelect ? pruneSelection(state.selected, rows) : new Set<string>();
  const detail = resetDetailForCursor(state, rows, filtered, cursor);
  const modal = modalStillValid(state.modal, rows);
  if (state.modal?.kind === "confirm" && modal === null) {
    state.modal.resolver(false);
  }
  const nextView = { ...state, rows, filtered, matchPositions, cursor, selected, detail, modal };
  const next = {
    ...nextView,
    actionState: recomputeActionState(nextView),
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

function detailItemRendered(
  state: ExplorerState,
  rowId: string,
  token: number,
  itemIndex: number,
  content: string
): StepResult {
  if (
    state.detail.rowId !== rowId ||
    state.detail.token !== token ||
    state.detail.items?.[itemIndex] === undefined
  ) {
    return mark(state, 0);
  }

  const items = state.detail.items.map((item, index) =>
    index === itemIndex ? { ...item, renderedContent: content } : item
  );
  const detail = { ...state.detail, items };
  return {
    state: clampDetailScroll({ ...state, detail, dirty: REGION_DETAIL }),
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

  return { state: { ...state, toast: null, dirty: REGION_FOOTER }, effects: NO_EFFECTS };
}

function suspendResumed(
  state: ExplorerState,
  emit: ExplorerEvent,
  runtimeHandles: ActionRuntimeHandles
): StepResult {
  const next = step(state, emit, runtimeHandles);
  return {
    state: { ...next.state, dirty: next.state.dirty | REGION_ALL },
    effects: next.effects
  };
}

function modalDismissed(
  state: ExplorerState,
  result: unknown,
  runtimeHandles: ActionRuntimeHandles
): StepResult {
  const modal = state.modal;
  const closed = { ...state, modal: null, dirty: REGION_MODAL | REGION_FOOTER };

  if (modal?.kind === "confirm") {
    modal.resolver(result === true);
  }

  if (modal?.kind !== "confirm" || result !== true) {
    return { state: closed, effects: NO_EFFECTS };
  }

  return dispatchAction(closed, modal.action, true, runtimeHandles, modal.rows);
}

function moveCursor(state: ExplorerState, delta: number): StepResult {
  if (state.focused === "detail" && hasDetailCursor(state)) {
    return moveDetailCursor(state, delta);
  }

  return setCursor(state, state.cursor + delta);
}

function moveDetailCursor(state: ExplorerState, delta: number): StepResult {
  const max = Math.max(0, (state.detail.items?.length ?? 0) - 1);
  const cursor = clamp(state.detail.cursor + delta, 0, max);
  if (cursor === state.detail.cursor) {
    return mark(state, 0);
  }

  const detail = { ...state.detail, cursor };
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

function hasDetailCursor(state: ExplorerState): boolean {
  const items = state.detail.items ?? [];
  return items.some((item) => item.title !== undefined);
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

  const matches = filterRows(filter, state.rows);
  const filtered = matches.map((match) => match.index);
  const matchPositions = createMatchPositions(matches);
  const cursor = clamp(0, 0, Math.max(0, filtered.length - 1));
  const detail = resetDetailForCursor({ ...state, filter }, state.rows, filtered, cursor);
  const next = {
    ...state,
    filter,
    filterFocused: filter === "" ? false : state.filterFocused,
    filtered,
    matchPositions,
    cursor,
    detail,
    actionState: recomputeActionState({
      ...state,
      filter,
      filtered,
      matchPositions,
      cursor,
      detail
    }),
    dirty: REGION_HEADER | REGION_LIST | REGION_DETAIL | REGION_FOOTER
  };
  const effect = detailEffect(next);

  return { state: next, effects: effect === undefined ? NO_EFFECTS : [effect] };
}

function focusFilter(state: ExplorerState): StepResult {
  if (state.filterFocused) {
    return mark(state, 0);
  }

  return {
    state: { ...state, filterFocused: true, dirty: REGION_HEADER | REGION_FOOTER },
    effects: NO_EFFECTS
  };
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

function escape(state: ExplorerState, runtimeHandles: ActionRuntimeHandles): StepResult {
  if (state.filterFocused || state.filter.length > 0) {
    const cleared = updateFilter({ ...state, filterFocused: false }, "");
    return {
      state: {
        ...cleared.state,
        filterFocused: false,
        dirty: cleared.state.dirty | REGION_HEADER | REGION_FOOTER
      },
      effects: cleared.effects
    };
  }

  if (state.selected.size > 0) {
    return clearSelection(state);
  }

  if (state.modal !== null) {
    return modalDismissed(state, false, runtimeHandles);
  }

  return { state: markDirty(state, 0), effects: [{ type: "exit", result: null }] };
}

function confirmKey(state: ExplorerState, runtimeHandles: ActionRuntimeHandles): StepResult {
  if (state.modal?.kind === "confirm") {
    return modalDismissed(state, true, runtimeHandles);
  }

  return dispatchPrimary(state, runtimeHandles);
}

function toggleSelect(state: ExplorerState): StepResult {
  if (!state.multiSelect) {
    return mark(state, 0);
  }

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
  if (!state.multiSelect) {
    return mark(state, 0);
  }

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
  const normalized = state.multiSelect ? selected : new Set<string>();
  if (setsEqual(state.selected, normalized)) {
    return mark(state, 0);
  }

  const next = {
    ...state,
    selected: normalized,
    actionState: recomputeActionState({ ...state, selected: normalized }),
    dirty: REGION_LIST | REGION_FOOTER
  };

  return { state: next, effects: NO_EFFECTS };
}

function detailScroll(state: ExplorerState, delta: number): StepResult {
  if (state.focused !== "detail") {
    return mark(state, 0);
  }

  const scroll = clamp(state.detail.scroll + delta, 0, maxDetailScroll(state));
  if (scroll === state.detail.scroll) {
    return mark(state, 0);
  }

  return {
    state: { ...state, detail: { ...state.detail, scroll }, dirty: REGION_DETAIL },
    effects: NO_EFFECTS
  };
}

function clampDetailScroll(state: ExplorerState): ExplorerState {
  const scroll = clamp(state.detail.scroll, 0, maxDetailScroll(state));
  if (scroll === state.detail.scroll) {
    return state;
  }

  return { ...state, detail: { ...state.detail, scroll } };
}

function maxDetailScroll(state: ExplorerState): number {
  const items = state.detail.items;
  if (items === null || items.length === 0) {
    return 0;
  }

  if (items.length === 1 && items[0]?.title === undefined) {
    const visibleHeight = detailBodyHeight(state);
    if (visibleHeight <= 0) {
      return 0;
    }
    return Math.max(0, detailContentLineCount(items[0]!) - visibleHeight);
  }

  return Math.max(0, items.length - 1);
}

function detailContentLineCount(item: DetailItem): number {
  return (item.renderedContent ?? "").split("\n").length;
}

function detailBodyHeight(state: ExplorerState): number {
  if (state.layout === "too-narrow" || state.layout === "narrow-list-only") {
    return 0;
  }

  const rows = normalizeSize(state.size.rows);
  const footerHeight = rows > 0 ? Math.min(1, rows) : 0;
  const headerHeight = Math.min(3, Math.max(0, rows - footerHeight));
  const contentHeight = Math.max(0, rows - headerHeight - footerHeight);

  if (state.layout === "narrow-vertical") {
    const listHeight = Math.ceil(contentHeight / 2);
    const detailHeight = contentHeight - listHeight;
    return Math.max(0, detailHeight - 2);
  }

  return Math.max(0, contentHeight - 2);
}

function extendSelection(state: ExplorerState, delta: number): StepResult {
  if (!state.multiSelect) {
    return moveCursor(state, delta);
  }

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
  const matchPositions = new Map<number, number[]>();
  const cursor = targetIndex;
  const next = {
    ...state,
    rows,
    filtered,
    matchPositions,
    cursor,
    actionState: recomputeActionState({ ...state, rows, filtered, matchPositions, cursor }),
    dirty: REGION_LIST | REGION_FOOTER
  };

  return {
    state: next,
    effects: [{ type: "persistOrder", orderedIds: rows.map((row) => row.id) }]
  };
}

function paletteInput(state: ExplorerState, key: ExplorerKeypressEvent): StepResult {
  if (state.modal?.kind !== "palette") {
    return mark(state, 0);
  }

  if (isBackspace(key)) {
    return setPaletteQuery(state, state.modal.query.slice(0, -1));
  }

  if (isPrintable(key)) {
    return setPaletteQuery(state, `${state.modal.query}${key.ch}`);
  }

  return mark(state, 0);
}

function setPaletteQuery(state: ExplorerState, query: string): StepResult {
  if (state.modal?.kind !== "palette") {
    return mark(state, 0);
  }

  const entries = paletteEntries({ ...state, modal: { ...state.modal, query } });
  return setModal(state, {
    ...state.modal,
    query,
    cursor: clamp(state.modal.cursor, 0, Math.max(0, entries.length - 1))
  });
}

function movePaletteCursor(state: ExplorerState, delta: number): StepResult {
  if (state.modal?.kind !== "palette") {
    return mark(state, 0);
  }

  const max = Math.max(0, paletteEntries(state).length - 1);
  const cursor = clamp(state.modal.cursor + delta, 0, max);
  if (cursor === state.modal.cursor) {
    return mark(state, 0);
  }

  return setModal(state, { ...state.modal, cursor });
}

function dispatchPaletteAction(
  state: ExplorerState,
  runtimeHandles: ActionRuntimeHandles
): StepResult {
  if (state.modal?.kind !== "palette") {
    return mark(state, 0);
  }

  const entry = paletteEntries(state)[state.modal.cursor];
  if (entry === undefined) {
    return mark(state, 0);
  }

  return dispatchActionById(
    { ...state, modal: null, dirty: REGION_MODAL | REGION_FOOTER },
    entry.id,
    false,
    runtimeHandles
  );
}

function dispatchPrimary(state: ExplorerState, runtimeHandles: ActionRuntimeHandles): StepResult {
  for (const [id, entry] of state.actionState.entries()) {
    if (entry.action?.primary === true && entry.available === true && entry.running !== true) {
      return dispatchActionById(state, id, false, runtimeHandles);
    }
  }

  return mark(state, 0);
}

function dispatchActionById(
  state: ExplorerState,
  actionId: string,
  confirmed: boolean,
  runtimeHandles: ActionRuntimeHandles
): StepResult {
  const entry = state.actionState.get(actionId);
  if (entry?.available !== true || entry.running === true || entry.action === undefined) {
    return mark(state, 0);
  }

  return dispatchAction(state, entry.action, confirmed, runtimeHandles);
}

function dispatchAction(
  state: ExplorerState,
  action: Action<unknown>,
  confirmed: boolean,
  runtimeHandles: ActionRuntimeHandles,
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
        fn: async () =>
          action.handler(
            buildActionContext(
              next,
              action,
              current?.source ?? actionSource(next, action),
              runtimeHandles,
              rows
            )
          ),
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
  if (!state.multiSelect || state.selected.size === 0) {
    const row = currentRow(state);
    return row === undefined ? [] : [row];
  }

  return state.rows.filter((row) => state.selected.has(row.id));
}

function paletteEntries(state: ExplorerState): Array<{ id: string; label: string }> {
  const query = state.modal?.kind === "palette" ? state.modal.query.toLocaleLowerCase() : "";
  const entries: Array<{ id: string; label: string }> = [];

  for (const [id, entry] of state.actionState.entries()) {
    if (entry.available !== true || entry.running === true || entry.action === undefined) {
      continue;
    }

    if (query !== "" && !entry.label.toLocaleLowerCase().includes(query)) {
      continue;
    }

    entries.push({ id, label: entry.label });
  }

  return entries;
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

function modalStillValid(modal: ExplorerState["modal"], rows: Row[]): ExplorerState["modal"] {
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

function createMatchPositions(matches: FilterMatch[]): Map<number, number[]> {
  return new Map(matches.map((match) => [match.index, match.positions]));
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

function isPrintable(key: ExplorerKeypressEvent): key is ExplorerKeypressEvent & { ch: string } {
  return key.ch !== undefined && !key.ctrl && !key.meta;
}

function isBackspace(key: ExplorerKeypressEvent): boolean {
  return key.name === "backspace" || key.name === "delete";
}

function isSelectionSpace(key: ExplorerKeypressEvent): boolean {
  return key.name === "space" || key.ch === " ";
}

function isConfirmYes(key: ExplorerKeypressEvent): boolean {
  return key.ch === "y" || key.ch === "Y";
}

function isConfirmNo(key: ExplorerKeypressEvent): boolean {
  return key.ch === "n" || key.ch === "N";
}
