import { describe, expect, it, vi } from "vitest";
import type { KeypressEvent } from "../dashboard/terminal.js";
import { buildActionContext, resolveAction, type ActionRuntimeHandles } from "./actions.js";
import { step } from "./reducer.js";
import {
  createInitialState,
  type Action,
  type DetailItem,
  type ExplorerConfig,
  type ExplorerState,
  type Row
} from "./state.js";

const rows: Row[] = [
  { id: "one", title: "One" },
  { id: "two", title: "Two" }
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

function key(ch: string): KeypressEvent {
  return { ch, ctrl: false, meta: false, shift: false };
}

function loadedState(overrides: Partial<ExplorerConfig<unknown>> = {}): ExplorerState {
  return step(createInitialState(config(overrides), { cols: 120, rows: 24 }), {
    type: "rowsLoaded",
    rows
  }).state;
}

function handles(): ActionRuntimeHandles {
  return {
    refresh: vi.fn(async () => undefined),
    reloadDetail: vi.fn(),
    suspendAnd: vi.fn(async (fn) => fn()),
    openModal: vi.fn(),
    toast: vi.fn(),
    confirm: vi.fn(async () => true),
    exit: vi.fn()
  };
}

describe("resolveAction", () => {
  it("resolves action bindings through memoized action state", () => {
    const action: Action<unknown> = {
      id: "archive",
      label: "Archive",
      key: "a",
      handler: () => undefined
    };

    expect(resolveAction(loadedState({ actions: [action] }), key("a"))).toBe(action);
  });

  it("returns null for builtins, unbound keys, unavailable actions, and running actions", () => {
    const action: Action<unknown> = {
      id: "archive",
      label: "Archive",
      key: "a",
      handler: () => undefined
    };
    const state = loadedState({ actions: [action] });
    const unavailable = new Map(state.actionState);
    unavailable.set("archive", { available: false, label: "Archive", action });
    const running = new Map(state.actionState);
    running.set("archive", { available: true, label: "Archive", running: true, action });

    expect(resolveAction(state, key("q"))).toBeNull();
    expect(resolveAction(state, key("x"))).toBeNull();
    expect(resolveAction({ ...state, actionState: unavailable }, key("a"))).toBeNull();
    expect(resolveAction({ ...state, actionState: running }, key("a"))).toBeNull();
  });

  it("consumes unavailable action keys instead of treating them as filter input", () => {
    const action: Action<unknown> = {
      id: "archive",
      label: "Archive",
      key: "a",
      handler: () => undefined
    };
    const state = loadedState({ actions: [action] });
    const actionState = new Map(state.actionState);
    actionState.set("archive", { available: false, label: "Archive", action });

    const next = step({ ...state, actionState }, { type: "key", key: key("a") });

    expect(next.state.filter).toBe("");
    expect(next.state.dirty).toBe(0);
    expect(next.effects).toEqual([]);
  });

  it("locks async actions until the reducer receives actionResolved", () => {
    const action: Action<unknown> = {
      id: "archive",
      label: "Archive",
      key: "a",
      handler: () => undefined
    };
    const dispatched = step(loadedState({ actions: [action] }), { type: "key", key: key("a") });
    const blocked = step(dispatched.state, { type: "key", key: key("a") });
    const resolved = step(dispatched.state, { type: "actionResolved", actionId: "archive" });

    expect(dispatched.state.actionState.get("archive")?.running).toBe(true);
    expect(dispatched.effects).toHaveLength(1);
    expect(blocked.effects).toEqual([]);
    expect(resolved.state.actionState.get("archive")?.running).toBe(false);
  });
});

describe("buildActionContext", () => {
  it("builds row-sourced contexts with selected rows and runtime handles", () => {
    const action: Action<unknown> = { id: "archive", label: "Archive", handler: () => undefined };
    const runtimeHandles = handles();
    const state = {
      ...loadedState({ actions: [action] }),
      selected: new Set(["two"])
    };

    const ctx = buildActionContext(state, action, "row", runtimeHandles);

    expect(ctx.row).toEqual(rows[0]);
    expect(ctx.rows).toEqual([rows[1]]);
    expect(ctx.item).toBeUndefined();
    expect(ctx.filter).toBe("");
    expect(ctx.refresh).toBe(runtimeHandles.refresh);
    expect(ctx.suspendAnd).toBe(runtimeHandles.suspendAnd);
    expect(ctx.toast).toBe(runtimeHandles.toast);
    expect(ctx.confirm).toBe(runtimeHandles.confirm);
    expect(ctx.exit).toBe(runtimeHandles.exit);
  });

  it("ignores stale selected rows when multi-select is disabled", () => {
    const action: Action<unknown> = { id: "archive", label: "Archive", handler: () => undefined };
    const state = {
      ...loadedState({ actions: [action], multiSelect: false }),
      selected: new Set(["two"])
    };

    const ctx = buildActionContext(state, action, "row", handles());

    expect(ctx.row).toEqual(rows[0]);
    expect(ctx.rows).toEqual([rows[0]]);
  });

  it("includes the focused detail item for detail-sourced contexts", () => {
    const item: DetailItem = {
      id: "detail-one",
      title: "Detail One",
      render: () => ""
    };
    const action: Action<unknown> = { id: "comment", label: "Comment", handler: () => undefined };
    const state = {
      ...loadedState({ detail: { items: async () => [], actions: [action] } }),
      detail: {
        rowId: "one",
        items: [item],
        cursor: 0,
        scroll: 0,
        token: 1,
        loading: false
      }
    };

    const ctx = buildActionContext(state, action, "detail", handles());

    expect(ctx.row).toEqual(rows[0]);
    expect(ctx.rows).toEqual([rows[0]]);
    expect(ctx.item).toBe(item);
  });
});
