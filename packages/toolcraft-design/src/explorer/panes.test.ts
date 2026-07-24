import { describe, expect, it } from "vitest";
import { buildActionContext } from "./actions.js";
import { step } from "./reducer.js";
import { createInitialState, normalizeExplorerConfig, type ExplorerConfig } from "./state.js";

describe("unified explorer panes", () => {
  it("normalizes list plus list through the shared detail state and exposes active panes", async () => {
    const config: ExplorerConfig<void> = {
      title: "Stash",
      panes: [
        { id: "left", kind: "list", title: "Local", rows: async () => [{ id: "local", title: "Local" }] },
        { id: "right", kind: "list", title: "Remote", rows: async () => [{ id: "remote", title: "Remote" }] }
      ],
      actions: [{ id: "move", label: "Move", accelerator: "m", handler: () => undefined }]
    };
    const normalized = normalizeExplorerConfig(config);
    const left = await normalized.rows();
    let state = step(createInitialState(config, { cols: 100, rows: 20 }), { type: "rowsLoaded", rows: left }).state;
    const right = await normalized.detail.items(left[0]!, { width: 40, height: 10, row: left[0]!, signal: new AbortController().signal });
    state = step(state, { type: "detailLoaded", rowId: "local", token: state.detail.token, items: right }).state;
    state = step(state, { type: "key", key: { name: "tab", ctrl: false, meta: false, shift: false } }).state;
    state = step(state, { type: "key", key: { name: "r", ch: "r", ctrl: false, meta: false, shift: false } }).state;
    expect(state.detail.filter).toBe("r");
    expect(state.filter).toBe("");
    const action = state.actionState.get("move")!.action!;
    const context = buildActionContext(state, action, "both", { refresh: async () => undefined, reloadDetail: () => undefined, suspendAnd: async fn => fn(), openModal: () => undefined, toast: () => undefined, confirm: async () => true, exit: () => undefined });
    expect(context.activePane?.id).toBe("right");
    expect(context.row.id).toBe("remote");
  });
});
