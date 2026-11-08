import { describe, expect, it, vi } from "vitest";
import { buildActionContext, resolveAction } from "./actions.js";
import { step } from "./reducer.js";
import { createInitialState, type Action, type ExplorerConfig } from "./state.js";

const action: Action<void> = {
  id: "edit",
  label: "Edit",
  accelerator: "e",
  handler: () => undefined
};
const config: ExplorerConfig<void> = {
  title: "Rows",
  rows: async () => [{ id: "one", title: "One" }],
  detail: { items: async () => [] },
  actions: [action]
};
function loaded() {
  return step(createInitialState(config, { cols: 100, rows: 20 }), {
    type: "rowsLoaded",
    rows: [{ id: "one", title: "One" }]
  }).state;
}

describe("explorer actions", () => {
  it("resolves Ctrl accelerators and never bare letters", () => {
    const state = loaded();
    expect(resolveAction(state, { ch: "e", ctrl: false, meta: false, shift: false })).toBeNull();
    expect(resolveAction(state, { ch: "e", ctrl: true, meta: false, shift: false })).toBe(action);
  });

  it("does not resolve unavailable or running actions", () => {
    const state = loaded();
    state.actionState.set("edit", { ...state.actionState.get("edit")!, available: false });
    expect(resolveAction(state, { ch: "e", ctrl: true, meta: false, shift: false })).toBeNull();
    state.actionState.set("edit", {
      ...state.actionState.get("edit")!,
      available: true,
      running: true
    });
    expect(resolveAction(state, { ch: "e", ctrl: true, meta: false, shift: false })).toBeNull();
  });

  it("builds contexts with selected rows and runtime handles", async () => {
    const state = loaded();
    state.selected.add("one");
    const refresh = vi.fn(async () => undefined);
    const context = buildActionContext(state, action, "row", {
      refresh,
      reloadDetail: vi.fn(),
      suspendAnd: async (fn) => fn(),
      openModal: vi.fn(),
      toast: vi.fn(),
      confirm: async () => true,
      promptText: async () => null,
      exit: vi.fn()
    });
    expect(context.row.id).toBe("one");
    expect(context.rows.map((row) => row.id)).toEqual(["one"]);
    await context.refresh();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
