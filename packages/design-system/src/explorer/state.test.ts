import { describe, expect, it } from "vitest";
import { createInitialState, REGION_ALL } from "./state.js";
import type { ExplorerConfig } from "./state.js";

function config(overrides: Partial<ExplorerConfig<unknown>> = {}): ExplorerConfig<unknown> {
  return {
    title: "Plans",
    rows: async () => [],
    detail: { items: async () => [] },
    actions: [],
    ...overrides
  };
}

describe("createInitialState", () => {
  it("creates the plan state shape with normalized viewport data", () => {
    const state = createInitialState(
      config({
        initialFilter: "auth",
        actions: [
          {
            id: "archive",
            label: "Archive",
            handler: () => undefined
          },
          {
            id: "dynamic",
            label: () => "Dynamic",
            handler: () => undefined
          }
        ],
        detail: {
          items: async () => [],
          actions: [
            {
              id: "comment",
              label: "Comment",
              handler: () => undefined
            }
          ]
        }
      }),
      { cols: 100.8, rows: Number.POSITIVE_INFINITY }
    );

    expect(state).toMatchObject({
      title: "Plans",
      rows: [],
      filtered: [],
      cursor: 0,
      filter: "auth",
      focused: "list",
      detail: {
        rowId: null,
        items: null,
        cursor: 0,
        scroll: 0,
        token: 0
      },
      modal: null,
      toast: null,
      dirty: REGION_ALL,
      size: { cols: 100, rows: 0 },
      layout: "medium"
    });
    expect(state.selected.size).toBe(0);
    expect(state.bindings.resolve({ ch: "q", ctrl: false, meta: false, shift: false })).toEqual({
      type: "builtin",
      id: "quit"
    });
    expect(state.actionState.get("archive")).toEqual({ available: true, label: "Archive" });
    expect(state.actionState.get("dynamic")).toEqual({ available: true, label: "dynamic" });
    expect(state.actionState.get("comment")).toEqual({ available: true, label: "Comment" });
  });

  it.each([
    [79, "narrow-list-only"],
    [80, "narrow-vertical"],
    [99, "narrow-vertical"],
    [100, "medium"],
    [119, "medium"],
    [120, "wide"]
  ] as const)("uses %s columns for %s layout", (cols, layout) => {
    expect(createInitialState(config(), { cols, rows: 24 }).layout).toBe(layout);
  });
});
