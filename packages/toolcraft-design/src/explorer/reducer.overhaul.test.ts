import { describe, expect, it, vi } from "vitest";
import { parseKeypress } from "../dashboard/terminal.js";
import { step } from "./reducer.js";
import { createInitialState, type ExplorerConfig, type Row } from "./state.js";

const rows: Row[] = [{ id: "one", title: "One" }, { id: "two", title: "Two" }, { id: "three", title: "Three" }];
function config(overrides: Partial<ExplorerConfig<void>> = {}): ExplorerConfig<void> {
  return { title: "Rows", rows: async () => rows, detail: { items: async () => [] }, actions: [], ...overrides };
}
function key(value: string) {
  const parsed = parseKeypress(Buffer.from(value));
  if (parsed === undefined) throw new Error("unparsed key");
  return parsed;
}

describe("explorer overhaul reducer regressions", () => {
  it("never invokes actions for printable English words", () => {
    const handler = vi.fn();
    let state = step(createInitialState(config({ actions: [{ id: "edit", label: "Edit", accelerator: "e", handler }] }), { cols: 100, rows: 20 }), { type: "rowsLoaded", rows }).state;
    for (const ch of "read") state = step(state, { type: "key", key: key(ch) }).state;
    expect(state.filter).toBe("read");
    expect(handler).not.toHaveBeenCalled();
  });

  it("follows row identity across refresh and falls back to a clamped index", () => {
    let state = step(createInitialState(config(), { cols: 100, rows: 20 }), { type: "rowsLoaded", rows }).state;
    state = step(state, { type: "key", key: key("\u001b[B") }).state;
    const reordered = [rows[2]!, rows[0]!, rows[1]!];
    state = step(state, { type: "rowsLoaded", rows: reordered }).state;
    expect(reordered[state.filtered[state.cursor]!]!.id).toBe("two");
  });

  it("opens the action menu on Enter and preserves previous detail while loading", () => {
    const action = { id: "edit", label: "Edit", accelerator: "e", handler: () => undefined };
    let state = step(createInitialState(config({ actions: [action] }), { cols: 100, rows: 20 }), { type: "rowsLoaded", rows }).state;
    state = { ...state, detail: { ...state.detail, items: [{ id: "old", render: () => "old" }] } };
    const moved = step(state, { type: "key", key: key("\u001b[B") });
    expect(moved.state.detail.items?.[0]?.id).toBe("old");
    expect(step(moved.state, { type: "key", key: key("\r") }).state.modal).toMatchObject({ kind: "palette" });
  });
});
