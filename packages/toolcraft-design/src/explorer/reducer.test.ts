import { describe, expect, it, vi } from "vitest";
import { parseKeypress } from "../dashboard/terminal.js";
import { step } from "./reducer.js";
import { createInitialState, type ExplorerConfig, type Row } from "./state.js";

const rows: Row[] = [
  { id: "one", title: "One" },
  { id: "two", title: "Two" },
  { id: "three", title: "Three" }
];
function config(overrides: Partial<ExplorerConfig<void>> = {}): ExplorerConfig<void> {
  return {
    title: "Rows",
    rows: async () => rows,
    detail: { items: async () => [] },
    actions: [],
    ...overrides
  };
}
function loaded(overrides: Partial<ExplorerConfig<void>> = {}) {
  return step(createInitialState(config(overrides), { cols: 100, rows: 20 }), {
    type: "rowsLoaded",
    rows
  }).state;
}
function key(value: string) {
  if (value === "escape") return { name: "escape", ctrl: false, meta: false, shift: false };
  const parsed = parseKeypress(Buffer.from(value));
  if (parsed === undefined) throw new Error("unparsed key");
  return parsed;
}

describe("explorer reducer", () => {
  it("navigates only with navigation keys and schedules token-owned detail", () => {
    const typed = step(loaded(), { type: "key", key: key("j") });
    expect(typed.state.cursor).toBe(0);
    expect(typed.state.filter).toBe("j");
    const moved = step(loaded(), { type: "key", key: key("\u001b[B") });
    expect(moved.state.cursor).toBe(1);
    expect(moved.effects).toEqual([{ type: "renderDetail", rowId: "two", token: 2 }]);
  });

  it("supports Home, End, pages, and Ctrl half-pages", () => {
    expect(step(loaded(), { type: "key", key: key("\u001b[F") }).state.cursor).toBe(2);
    const atEnd = { ...loaded(), cursor: 2 };
    expect(step(atEnd, { type: "key", key: key("\u001b[H") }).state.cursor).toBe(0);
    expect(step(loaded(), { type: "key", key: key("\u0004") }).state.cursor).toBeGreaterThan(0);
  });

  it("toggles selection with Space and cycles focus with Tab", () => {
    const selected = step(loaded(), {
      type: "key",
      key: { name: "space", ctrl: false, meta: false, shift: false }
    });
    expect([...selected.state.selected]).toEqual(["one"]);
    expect(step(selected.state, { type: "key", key: key("\t") }).state.focused).toBe("detail");
  });

  it("applies modal, filter, then quit Escape semantics", () => {
    const filtered = { ...loaded(), filter: "one" };
    const cleared = step(filtered, { type: "key", key: key("escape") });
    expect(cleared.state.filter).toBe("");
    expect(step(cleared.state, { type: "key", key: key("escape") }).effects).toEqual([{ type: "exit", result: null }]);
  });

  it("confirms destructive actions selected from the menu", () => {
    const handler = vi.fn();
    const state = loaded({
      actions: [{ id: "remove", label: "Remove", accelerator: "x", destructive: true, handler }]
    });
    const accelerated = step(state, {
      type: "key",
      key: { ch: "x", ctrl: true, meta: false, shift: false }
    });
    expect(accelerated.state.modal).toMatchObject({
      kind: "confirm",
      message: "Remove One?",
      confirmLabel: "Remove"
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("traps all keys inside a text-input overlay and resolves only on submit", () => {
    const resolver = vi.fn();
    const state = {
      ...loaded(),
      modal: { kind: "input" as const, title: "Save plan", label: "Reason", value: "", resolver }
    };

    const typed = step(state, { type: "key", key: key("q") });
    expect(typed.state.modal).toMatchObject({ kind: "input", value: "q" });
    expect(typed.effects).toEqual([]);
    const submitted = step(typed.state, { type: "key", key: key("\r") });
    expect(submitted.state.modal).toBeNull();
    expect(resolver).toHaveBeenCalledWith("q");
  });

  it("drops stale detail results and accepts the reducer token", () => {
    const state = loaded();
    const stale = step(state, {
      type: "detailLoaded",
      rowId: "one",
      token: 0,
      items: [{ id: "stale", render: () => "" }]
    });
    expect(stale.state.detail.items).toBeNull();
    const fresh = step(state, {
      type: "detailLoaded",
      rowId: "one",
      token: state.detail.token,
      items: [{ id: "fresh", render: () => "" }]
    });
    expect(fresh.state.detail.items?.[0]?.id).toBe("fresh");
  });
});
