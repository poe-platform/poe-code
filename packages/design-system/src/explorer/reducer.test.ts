import { describe, expect, it, vi } from "vitest";
import { parseKeypress, type KeypressEvent } from "../dashboard/terminal.js";
import { step } from "./reducer.js";
import {
  createInitialState,
  REGION_ALL,
  REGION_DETAIL,
  REGION_FOOTER,
  REGION_HEADER,
  REGION_LIST,
  REGION_MODAL,
  REGION_TOAST,
  type Action,
  type ExplorerConfig,
  type ExplorerState,
  type Row
} from "./state.js";

const rows: Row[] = [
  { id: "one", title: "One" },
  { id: "two", title: "Two" },
  { id: "three", title: "Three" }
];

function config(overrides: Partial<ExplorerConfig<unknown>> = {}): ExplorerConfig<unknown> {
  return {
    title: "Plans",
    rows: async () => [],
    detail: { items: async () => [] },
    actions: [],
    ...overrides
  };
}

function loadedState(overrides: Partial<ExplorerConfig<unknown>> = {}): ExplorerState {
  const state = createInitialState(config(overrides), { cols: 120, rows: 24 });
  return step(state, { type: "rowsLoaded", rows }).state;
}

function key(sequence: string): KeypressEvent {
  if (sequence === "\u001b") {
    return { name: "escape", ctrl: false, meta: false, shift: false };
  }

  const event = parseKeypress(Buffer.from(sequence));
  if (event === undefined) {
    throw new Error(`Could not parse ${JSON.stringify(sequence)}`);
  }
  return event;
}

function actionEntry(action: Action<unknown>) {
  return {
    available: true,
    label: typeof action.label === "string" ? action.label : action.id,
    action
  };
}

describe("step", () => {
  it("moves the cursor up and down with clamping and schedules detail loads", () => {
    const state = loadedState();
    const down = step(state, { type: "key", key: key("j") });
    const downAgain = step(down.state, { type: "key", key: key("j") });
    const clamped = step(downAgain.state, { type: "key", key: key("j") });
    const up = step(clamped.state, { type: "key", key: key("k") });

    expect(down.state.cursor).toBe(1);
    expect(down.effects).toEqual([{ type: "renderDetail", rowId: "two", token: 2 }]);
    expect(down.state.dirty).toBe(REGION_LIST | REGION_DETAIL | REGION_FOOTER);
    expect(clamped.state.cursor).toBe(2);
    expect(clamped.effects).toEqual([]);
    expect(up.state.cursor).toBe(1);
    expect(up.effects).toEqual([{ type: "renderDetail", rowId: "two", token: 4 }]);
  });

  it("types and clears the filter", () => {
    const filtered = step(loadedState(), { type: "key", key: key("t") });
    const cleared = step(filtered.state, { type: "key", key: key("\u001b") });

    expect(filtered.state.filter).toBe("t");
    expect(filtered.state.filtered.map((index) => rows[index]?.id)).toEqual(["two", "three"]);
    expect(filtered.state.dirty).toBe(REGION_HEADER | REGION_LIST | REGION_DETAIL | REGION_FOOTER);
    expect(cleared.state.filter).toBe("");
    expect(cleared.state.filtered.map((index) => rows[index]?.id)).toEqual(["one", "two", "three"]);
  });

  it("toggles multi-select by row id", () => {
    const selected = step(loadedState(), { type: "key", key: key(" ") });
    const cleared = step(selected.state, { type: "key", key: key(" ") });

    expect([...selected.state.selected]).toEqual(["one"]);
    expect(selected.state.dirty).toBe(REGION_LIST | REGION_FOOTER);
    expect(cleared.state.selected.size).toBe(0);
  });

  it("cycles focus with Tab", () => {
    const detailFocused = step(loadedState(), { type: "key", key: key("\t") });
    const listFocused = step(detailFocused.state, { type: "key", key: key("\t") });

    expect(detailFocused.state.focused).toBe("detail");
    expect(detailFocused.state.dirty).toBe(REGION_LIST | REGION_DETAIL | REGION_FOOTER);
    expect(listFocused.state.focused).toBe("list");
  });

  it("applies Esc semantics in priority order", () => {
    const withFilter = { ...loadedState(), filter: "one", selected: new Set(["two"]) };
    const filterCleared = step(withFilter, { type: "key", key: key("\u001b") });
    const selectionCleared = step(filterCleared.state, { type: "key", key: key("\u001b") });
    const modalClosed = step(
      { ...selectionCleared.state, modal: { kind: "help" } },
      { type: "key", key: key("\u001b") }
    );
    const quit = step(modalClosed.state, { type: "key", key: key("\u001b") });

    expect(filterCleared.state.filter).toBe("");
    expect(filterCleared.state.selected.size).toBe(1);
    expect(selectionCleared.state.selected.size).toBe(0);
    expect(modalClosed.state.modal).toBeNull();
    expect(quit.effects).toEqual([{ type: "exit", result: null }]);
  });

  it("enqueues a confirm modal for destructive actions", () => {
    const action: Action<unknown> = {
      id: "delete",
      label: "Delete",
      key: "d",
      destructive: true,
      handler: () => undefined
    };
    const state = loadedState({ actions: [action] });
    state.actionState.set("delete", actionEntry(action));

    const next = step(state, { type: "key", key: key("d") });

    expect(next.effects).toEqual([]);
    expect(next.state.modal).toMatchObject({
      kind: "confirm",
      action,
      rows: [rows[0]]
    });
    expect(next.state.dirty).toBe(REGION_MODAL | REGION_FOOTER);
  });

  it("forwards confirmed modal resolution to the action dispatcher", async () => {
    const handler = vi.fn();
    const action: Action<unknown> = {
      id: "delete",
      label: "Delete",
      destructive: true,
      handler
    };
    const state = {
      ...loadedState(),
      modal: { kind: "confirm" as const, action, rows: [rows[0]], resolver: () => undefined }
    };

    const next = step(state, { type: "modalDismissed", result: true });

    expect(next.state.modal).toBeNull();
    expect(next.effects).toHaveLength(1);
    expect(next.effects[0]?.type).toBe("suspend");
    if (next.effects[0]?.type === "suspend") {
      await next.effects[0].fn();
    }
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ row: rows[0], rows: [rows[0]] }));
  });

  it("gates reorder to an unfiltered list focus with no modal", () => {
    const state = loadedState({ reorder: { onReorder: () => undefined } });
    const moved = step(state, {
      type: "key",
      key: { name: "down", ctrl: true, meta: false, shift: false }
    });
    const filtered = step({ ...state, filter: "one" }, {
      type: "key",
      key: { name: "down", ctrl: true, meta: false, shift: false }
    });
    const detailFocused = step({ ...state, focused: "detail" }, {
      type: "key",
      key: { name: "down", ctrl: true, meta: false, shift: false }
    });
    const modalOpen = step({ ...state, modal: { kind: "help" } }, {
      type: "key",
      key: { name: "down", ctrl: true, meta: false, shift: false }
    });

    expect(moved.state.rows.map((row) => row.id)).toEqual(["two", "one", "three"]);
    expect(moved.effects).toEqual([{ type: "persistOrder", orderedIds: ["two", "one", "three"] }]);
    expect(filtered.effects).toEqual([]);
    expect(detailFocused.effects).toEqual([]);
    expect(modalOpen.effects).toEqual([]);
  });

  it("recomputes memoized action state after cursor and filter changes", () => {
    const action: Action<unknown> = {
      id: "only-two",
      label: () => "Only current two",
      predicate: (ctx) => ctx.row.id === "two",
      handler: () => undefined
    };
    const state = loadedState({ actions: [action] });
    state.actionState.set("only-two", actionEntry(action));

    const onTwo = step(state, { type: "key", key: key("j") });
    const filteredToThree = step(onTwo.state, { type: "key", key: key("h") });

    expect(onTwo.state.actionState.get("only-two")).toEqual({
      available: true,
      label: "Only current two",
      action
    });
    expect(filteredToThree.state.actionState.get("only-two")).toMatchObject({
      available: false,
      label: "Only current two"
    });
  });

  it("updates layout on resize through computeExplorerLayout", () => {
    const next = step(loadedState(), { type: "resize", cols: 39.8, rows: 10.9 });

    expect(next.state.size).toEqual({ cols: 39, rows: 10 });
    expect(next.state.layout).toBe("too-narrow");
    expect(next.state.dirty).toBe(REGION_ALL);
  });

  it("expires toasts and leaves absent toasts unchanged", () => {
    const withToast = {
      ...loadedState(),
      toast: { message: "Saved", tone: "success" as const, expiresAt: 1 }
    };

    expect(step(withToast, { type: "toastExpired" }).state).toMatchObject({
      toast: null,
      dirty: REGION_TOAST
    });
    expect(step(loadedState(), { type: "toastExpired" }).state.dirty).toBe(0);
  });
});
