import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseKeypress } from "../dashboard/terminal.js";
import { step } from "./reducer.js";
import { createInitialState, type ExplorerState } from "./state.js";

describe.each([
  "list",
  "detail",
  "filter",
  "focused filter",
  "second-list filter",
  "palette",
  "help",
  "content",
  "input",
  "confirm"
])("Explorer global quit: %s", (surface) => {
  let state: ExplorerState;
  let resolver: ReturnType<typeof vi.fn>;
  let handler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resolver = vi.fn();
    handler = vi.fn();
    const rows = [
      { id: "one", title: "One" },
      { id: "two", title: "Two" }
    ];
    state = step(
      createInitialState(
        {
          title: "Rows",
          rows: async () => rows,
          detail: { items: async () => [] },
          actions: []
        },
        { cols: 120, rows: 20 }
      ),
      { type: "rowsLoaded", rows }
    ).state;

    if (surface === "detail") {
      state = { ...state, focused: "detail" };
    } else if (surface === "filter" || surface === "focused filter") {
      state = {
        ...state,
        filter: "one",
        filtered: [0],
        filterFocused: surface === "focused filter"
      };
    } else if (surface === "second-list filter") {
      state = {
        ...state,
        focused: "detail",
        paneDefinitions: [
          { id: "first", title: "First", kind: "list" },
          { id: "second", title: "Second", kind: "list" }
        ],
        detail: { ...state.detail, filter: "one" }
      };
    } else if (surface === "palette") {
      state = { ...state, modal: { kind: "palette", query: "one", cursor: 0 } };
    } else if (surface === "help") {
      state = { ...state, modal: { kind: "help" } };
    } else if (surface === "content") {
      state = {
        ...state,
        modal: { kind: "content", title: "Preview", content: "Details", scroll: 0 }
      };
    } else if (surface === "input") {
      state = {
        ...state,
        modal: { kind: "input", title: "Input", label: "Name", value: "draft", resolver }
      };
    } else if (surface === "confirm") {
      state = {
        ...state,
        modal: {
          kind: "confirm",
          title: "Confirm",
          message: "Remove?",
          confirmLabel: "Remove",
          cancelLabel: "Cancel",
          destructive: true,
          resolver,
          action: { id: "remove", label: "Remove", destructive: true, handler },
          rows
        }
      };
    }
    if (state.modal !== null) {
      state = { ...state, filter: "one", filtered: [0], filterFocused: true };
    }
  });

  it("cancels any modal and exits on one parsed Ctrl+C", () => {
    const quit = parseKeypress(Buffer.from("\u0003"));
    expect(quit).toBeDefined();
    const result = step(state, { type: "key", key: quit! });

    expect(result.effects).toEqual([{ type: "exit", result: null }]);
    expect(result.state.modal).toBeNull();
    expect(result.state.filter).toBe(state.filter);
    expect(result.state.detail.filter).toBe(state.detail.filter);
    expect(handler).not.toHaveBeenCalled();
    if (surface === "input" || surface === "confirm") {
      expect(resolver).toHaveBeenCalledExactlyOnceWith(surface === "input" ? null : false);
    } else {
      expect(resolver).not.toHaveBeenCalled();
    }
  });

  it("preserves Escape dismissal, filter clearing, and ordinary exit", () => {
    const escape = parseKeypress(Buffer.from("\u001b"));
    expect(escape).toBeDefined();
    const result = step(state, { type: "key", key: escape! });

    if (state.modal !== null) {
      expect(result.state.modal).toBeNull();
      expect(result.state.filter).toBe("one");
      expect(result.effects).toEqual([]);
    } else if (surface === "filter" || surface === "focused filter") {
      expect(result.state.filter).toBe("");
      expect(result.state.filterFocused).toBe(false);
      expect(result.effects.some((effect) => effect.type === "exit")).toBe(false);
    } else if (surface === "second-list filter") {
      expect(result.state.detail.filter).toBe("");
      expect(result.effects).toEqual([]);
    } else {
      expect(result.effects).toEqual([{ type: "exit", result: null }]);
    }
    expect(handler).not.toHaveBeenCalled();
    if (surface === "input" || surface === "confirm") {
      expect(resolver).toHaveBeenCalledExactlyOnceWith(surface === "input" ? null : false);
    } else {
      expect(resolver).not.toHaveBeenCalled();
    }
  });
});
