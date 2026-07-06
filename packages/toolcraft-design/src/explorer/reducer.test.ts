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
    expect(filtered.state.matchPositions.get(1)).toEqual([0]);
    expect(filtered.state.matchPositions.get(2)).toEqual([0]);
    expect(filtered.state.dirty).toBe(REGION_HEADER | REGION_LIST | REGION_DETAIL | REGION_FOOTER);
    expect(cleared.state.filter).toBe("");
    expect(cleared.state.filtered.map((index) => rows[index]?.id)).toEqual(["one", "two", "three"]);
    expect(cleared.state.matchPositions.get(0)).toEqual([]);
  });

  it("captures action keys as filter text after slash focuses the filter", () => {
    const refresh = vi.fn();
    const action: Action<unknown> = {
      id: "refresh",
      label: "Refresh",
      key: "r",
      handler: refresh
    };
    const state = loadedState({ actions: [action] });
    state.actionState.set("refresh", actionEntry(action));

    const focused = step(state, { type: "key", key: key("/") });
    const typed = step(focused.state, { type: "key", key: key("r") });
    const submitted = step(typed.state, { type: "key", key: key("\r") });
    const actionRun = step(submitted.state, { type: "key", key: key("r") });

    expect(focused.state.filterFocused).toBe(true);
    expect(typed.state.filter).toBe("r");
    expect(typed.effects).toEqual([{ type: "renderDetail", rowId: "three", token: 2 }]);
    expect(submitted.state.filterFocused).toBe(false);
    expect(actionRun.effects).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("leaves filter entry when backspace clears the query", () => {
    const state = { ...loadedState(), filterFocused: true, filter: "t" };
    const next = step(state, { type: "key", key: key("\x7f") });

    expect(next.state.filter).toBe("");
    expect(next.state.filterFocused).toBe(false);
  });

  it("toggles multi-select by row id", () => {
    const selected = step(loadedState(), { type: "key", key: key(" ") });
    const cleared = step(selected.state, { type: "key", key: key(" ") });
    const selectedByNamedSpace = step(loadedState(), {
      type: "key",
      key: { name: "space", ctrl: false, meta: false, shift: false }
    });

    expect([...selected.state.selected]).toEqual(["one"]);
    expect(selected.state.dirty).toBe(REGION_LIST | REGION_FOOTER);
    expect(cleared.state.selected.size).toBe(0);
    expect([...selectedByNamedSpace.state.selected]).toEqual(["one"]);
  });

  it("ignores selection keys when multi-select is disabled", () => {
    const state = loadedState({ multiSelect: false });
    const space = step(state, { type: "key", key: key(" ") });
    const selectAll = step(space.state, { type: "key", key: key("\u0001") });
    const shifted = step(selectAll.state, { type: "key", key: key("\u001b[1;2B") });

    expect(space.state.selected.size).toBe(0);
    expect(space.state.filter).toBe("");
    expect(selectAll.state.selected.size).toBe(0);
    expect(shifted.state.selected.size).toBe(0);
    expect(shifted.state.cursor).toBe(0);
  });

  it("clears stale selection when rows load with multi-select disabled", () => {
    const state = { ...loadedState({ multiSelect: false }), selected: new Set(["one", "two"]) };
    const next = step(state, { type: "rowsLoaded", rows });

    expect(next.state.selected.size).toBe(0);
  });

  it("cycles focus with Tab", () => {
    const detailFocused = step(loadedState(), { type: "key", key: key("\t") });
    const listFocused = step(detailFocused.state, { type: "key", key: key("\t") });

    expect(detailFocused.state.focused).toBe("detail");
    expect(detailFocused.state.dirty).toBe(REGION_LIST | REGION_DETAIL | REGION_FOOTER);
    expect(listFocused.state.focused).toBe("list");
  });

  it("moves the detail item cursor when the detail pane is focused", () => {
    const state = {
      ...loadedState(),
      focused: "detail" as const,
      detail: {
        rowId: "one",
        items: [
          { id: "comment-one", title: "Comment one", render: () => "one" },
          { id: "comment-two", title: "Comment two", render: () => "two" }
        ],
        cursor: 0,
        scroll: 0,
        token: 1,
        loading: false
      }
    };

    const moved = step(state, { type: "key", key: key("j") });
    const clamped = step(moved.state, { type: "key", key: key("j") });
    const up = step(clamped.state, { type: "key", key: key("k") });

    expect(moved.state.cursor).toBe(0);
    expect(moved.state.detail.cursor).toBe(1);
    expect(moved.effects).toEqual([]);
    expect(clamped.state.detail.cursor).toBe(1);
    expect(up.state.detail.cursor).toBe(0);
  });

  it("clamps detail blob scrolling to rendered content", () => {
    let current: ExplorerState = {
      ...loadedState(),
      focused: "list" as const,
      size: { cols: 120, rows: 8 },
      layout: "wide" as const,
      detail: {
        rowId: "one",
        items: [
          {
            id: "body",
            renderedContent: ["one", "two", "three", "four", "five", "six"].join("\n"),
            render: () => ""
          }
        ],
        cursor: 0,
        scroll: 0,
        token: 1,
        loading: false
      }
    };

    for (let index = 0; index < 5; index += 1) {
      current = step(current, {
        type: "key",
        key: { ch: "f", ctrl: true, meta: false, shift: false }
      }).state;
    }

    expect(current.detail.scroll).toBe(4);

    const up = step(current, {
      type: "key",
      key: { ch: "b", ctrl: true, meta: false, shift: false }
    });

    expect(up.state.detail.scroll).toBe(3);
  });

  it("scrolls a focused detail blob with arrow and page keys", () => {
    const blobState = (): ExplorerState => ({
      ...loadedState(),
      focused: "detail" as const,
      size: { cols: 120, rows: 8 },
      layout: "wide" as const,
      detail: {
        rowId: "one",
        items: [
          {
            id: "body",
            renderedContent: Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n"),
            render: () => ""
          }
        ],
        cursor: 0,
        scroll: 0,
        token: 1,
        loading: false
      }
    });

    const down = step(blobState(), {
      type: "key",
      key: { name: "down", ctrl: false, meta: false, shift: false }
    });
    expect(down.state.detail.scroll).toBe(1);
    expect(down.state.cursor).toBe(0);

    const paged = step(blobState(), {
      type: "key",
      key: { ch: "d", ctrl: true, meta: false, shift: false }
    });
    expect(paged.state.detail.scroll).toBeGreaterThan(1);

    const pagedBack = step(paged.state, {
      type: "key",
      key: { ch: "u", ctrl: true, meta: false, shift: false }
    });
    expect(pagedBack.state.detail.scroll).toBe(0);
  });

  it("clamps detail list scrolling to the final item", () => {
    let current: ExplorerState = {
      ...loadedState(),
      focused: "detail" as const,
      detail: {
        rowId: "one",
        items: [
          { id: "comment-one", title: "Comment one", render: () => "one" },
          { id: "comment-two", title: "Comment two", render: () => "two" }
        ],
        cursor: 0,
        scroll: 0,
        token: 1,
        loading: false
      }
    };

    for (let index = 0; index < 5; index += 1) {
      current = step(current, {
        type: "key",
        key: { ch: "f", ctrl: true, meta: false, shift: false }
      }).state;
    }

    expect(current.detail.scroll).toBe(1);
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
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ row: rows[0], rows: [rows[0]] })
    );
  });

  it("lets the command palette own text keys and run the matching action on Enter", async () => {
    const archive = vi.fn();
    const refresh = vi.fn();
    const archiveAction: Action<unknown> = {
      id: "archive",
      label: "Archive selected",
      key: "a",
      destructive: true,
      handler: archive
    };
    const refreshAction: Action<unknown> = {
      id: "refresh",
      label: "Refresh",
      key: "r",
      handler: refresh
    };
    const state = {
      ...loadedState({ actions: [archiveAction, refreshAction] }),
      modal: { kind: "palette" as const, query: "", cursor: 0 }
    };
    state.actionState.set("archive", actionEntry(archiveAction));
    state.actionState.set("refresh", actionEntry(refreshAction));

    const typedActionKey = step(state, { type: "key", key: key("r") });
    const typedRefresh = step(typedActionKey.state, { type: "key", key: key("e") });
    const submitted = step(typedRefresh.state, { type: "key", key: key("\r") });

    expect(typedActionKey.state.modal).toMatchObject({ kind: "palette", query: "r" });
    expect(typedActionKey.effects).toEqual([]);
    expect(typedRefresh.state.modal).toMatchObject({ kind: "palette", query: "re" });
    expect(submitted.state.modal).toBeNull();
    expect(submitted.effects).toHaveLength(1);
    if (submitted.effects[0]?.type === "suspend") {
      await submitted.effects[0].fn();
    }
    expect(refresh).toHaveBeenCalledOnce();
    expect(archive).not.toHaveBeenCalled();
  });

  it("keeps action keys inert while a confirm modal is open", () => {
    const action: Action<unknown> = {
      id: "archive",
      label: "Archive selected",
      key: "a",
      destructive: true,
      handler: () => undefined
    };
    const state = {
      ...loadedState({ actions: [action] }),
      modal: { kind: "confirm" as const, action, rows: [rows[0]], resolver: () => undefined }
    };
    state.actionState.set("archive", actionEntry(action));

    const next = step(state, { type: "key", key: key("a") });

    expect(next.state.modal).toEqual(state.modal);
    expect(next.effects).toEqual([]);
  });

  it("scrolls and dismisses content modals without exiting the explorer", () => {
    const state = {
      ...loadedState(),
      modal: {
        kind: "content" as const,
        title: "Trace detail",
        content: ["one", "two", "three", "four", "five"].join("\n"),
        scroll: 0
      },
      size: { cols: 80, rows: 6 }
    };

    const down = step(state, {
      type: "key",
      key: { ch: "f", ctrl: true, meta: false, shift: false }
    });
    const dismissed = step(down.state, { type: "key", key: key("\u001b") });
    const quit = step(dismissed.state, { type: "key", key: key("\u001b") });

    expect(down.state.modal).toMatchObject({ kind: "content", scroll: 1 });
    expect(down.effects).toEqual([]);
    expect(dismissed.state.modal).toBeNull();
    expect(dismissed.effects).toEqual([]);
    expect(quit.effects).toEqual([{ type: "exit", result: null }]);
  });

  it("opens content modals from action handlers without an exit effect", async () => {
    const action: Action<unknown> = {
      id: "open",
      label: "Open",
      key: "o",
      handler: (ctx) => {
        ctx.openModal({ title: "Trace detail", content: "hello" });
      }
    };
    const state = loadedState({ actions: [action] });
    state.actionState.set("open", actionEntry(action));

    const next = step(state, { type: "key", key: key("o") });

    expect(next.effects).toHaveLength(1);
    expect(next.effects[0]?.type).toBe("suspend");
    if (next.effects[0]?.type === "suspend") {
      await next.effects[0].fn();
    }
  });

  it("keeps the modal-captured rows when confirming a destructive action", async () => {
    const handler = vi.fn();
    const action: Action<unknown> = {
      id: "delete",
      label: "Delete",
      destructive: true,
      handler
    };
    const state = {
      ...loadedState(),
      cursor: 2,
      selected: new Set(["three"]),
      modal: { kind: "confirm" as const, action, rows: [rows[0]], resolver: () => undefined }
    };

    const next = step(state, { type: "modalDismissed", result: true });

    expect(next.effects).toHaveLength(1);
    if (next.effects[0]?.type === "suspend") {
      await next.effects[0].fn();
    }
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ row: rows[0], rows: [rows[0]] })
    );
  });

  it("gates reorder to an unfiltered list focus with no modal", () => {
    const state = loadedState({ reorder: { onReorder: () => undefined } });
    const moved = step(state, {
      type: "key",
      key: { name: "down", ctrl: false, meta: false, shift: true }
    });
    const filtered = step(
      { ...state, filter: "one" },
      {
        type: "key",
        key: { name: "down", ctrl: false, meta: false, shift: true }
      }
    );
    const detailFocused = step(
      { ...state, focused: "detail" },
      {
        type: "key",
        key: { name: "down", ctrl: false, meta: false, shift: true }
      }
    );
    const modalOpen = step(
      { ...state, modal: { kind: "help" } },
      {
        type: "key",
        key: { name: "down", ctrl: false, meta: false, shift: true }
      }
    );

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
      dirty: REGION_FOOTER
    });
    expect(step(loadedState(), { type: "toastExpired" }).state.dirty).toBe(0);
  });

  it("dismisses confirmations invalidated by refreshed rows", () => {
    const resolver = vi.fn();
    const action: Action<unknown> = { id: "delete", label: "Delete", handler: () => undefined };
    const state = {
      ...loadedState(),
      modal: { kind: "confirm" as const, action, rows: [rows[0]], resolver }
    };

    const next = step(state, { type: "rowsLoaded", rows: [rows[1]!] });

    expect(next.state.modal).toBeNull();
    expect(resolver).toHaveBeenCalledWith(false);
  });

  it("does not dispatch detail action keys while list-focused", () => {
    const action: Action<unknown> = {
      id: "comment",
      label: "Comment",
      key: "c",
      handler: () => undefined
    };
    const state = loadedState({ detail: { items: async () => [], actions: [action] } });

    expect(step(state, { type: "key", key: key("c") }).effects).toEqual([]);
    expect(
      step({ ...state, focused: "detail" }, { type: "key", key: key("c") }).effects
    ).toHaveLength(1);
  });

  it("dispatches the first available primary action", () => {
    const blocked: Action<unknown> = {
      id: "blocked",
      label: "Blocked",
      primary: true,
      predicate: () => false,
      handler: () => undefined
    };
    const available: Action<unknown> = {
      id: "available",
      label: "Available",
      primary: true,
      handler: () => undefined
    };

    const next = step(loadedState({ actions: [blocked, available] }), {
      type: "key",
      key: key("\r")
    });

    expect(next.state.actionState.get("available")?.running).toBe(true);
  });

  it("recomputes action state after refreshing away selected rows", () => {
    const action: Action<unknown> = {
      id: "open",
      label: "Open",
      predicate: (ctx) => ctx.rows.every((row) => row.id !== "removed"),
      handler: () => undefined
    };
    const state = step(createInitialState(config({ actions: [action] }), { cols: 120, rows: 24 }), {
      type: "rowsLoaded",
      rows: [{ id: "removed", title: "Removed" }]
    }).state;

    const next = step(
      { ...state, selected: new Set(["removed"]) },
      {
        type: "rowsLoaded",
        rows: [{ id: "replacement", title: "Replacement" }]
      }
    );

    expect(next.state.selected.size).toBe(0);
    expect(next.state.actionState.get("open")?.available).toBe(true);
  });

  it("rejects duplicate row identifiers from refresh data", () => {
    expect(() =>
      step(loadedState(), {
        type: "rowsLoaded",
        rows: [
          { id: "same", title: "First" },
          { id: "same", title: "Second" }
        ]
      })
    ).toThrow("Duplicate explorer row id: same");
  });
});
