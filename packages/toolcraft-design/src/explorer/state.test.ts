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
        token: 0,
        loading: false
      },
      modal: null,
      toast: null,
      dirty: REGION_ALL,
      size: { cols: 100, rows: 0 },
      layout: "too-narrow",
      multiSelect: true
    });
    expect(state.selected.size).toBe(0);
    expect(state.matchPositions.size).toBe(0);
    expect(state.bindings.resolve({ ch: "c", ctrl: true, meta: false, shift: false })).toEqual({
      type: "builtin",
      id: "quit"
    });
    expect(state.actionState.get("archive")).toMatchObject({
      available: true,
      label: "Archive",
      source: "row"
    });
    expect(state.actionState.get("dynamic")).toMatchObject({
      available: true,
      label: "dynamic",
      source: "row"
    });
    expect(state.actionState.get("comment")).toMatchObject({
      available: true,
      label: "Comment",
      source: "detail"
    });
  });

  it("stores disabled multi-select configuration", () => {
    const state = createInitialState(config({ multiSelect: false }), { cols: 120, rows: 24 });

    expect(state.multiSelect).toBe(false);
    expect(state.selected.size).toBe(0);
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

  it("rejects duplicate row and detail action identifiers", () => {
    const rowAction = { id: "open", label: "Open row", handler: () => undefined };
    const detailAction = { id: "open", label: "Open detail", handler: () => undefined };

    expect(() => createInitialState(config({
      actions: [rowAction],
      detail: { items: async () => [], actions: [detailAction] }
    }), { cols: 120, rows: 24 })).toThrow("Duplicate explorer action id: open");
  });

  it("seeds rows from initialRows for first paint", () => {
    const state = createInitialState(
      config({
        initialRows: [
          { id: "one", title: "One" },
          { id: "two", title: "Two" }
        ]
      }),
      { cols: 120, rows: 24 }
    );

    expect(state.rows.map((row) => row.id)).toEqual(["one", "two"]);
    expect(state.filtered).toEqual([0, 1]);
    expect(state.detail.rowId).toBe("one");
    expect(state.detail.loading).toBe(true);
  });
});
