import { beforeEach, describe, expect, it } from "vitest";
import { parseKeypress } from "../dashboard/terminal.js";
import { step } from "./reducer.js";
import { createInitialState, REGION_DETAIL, type ExplorerState } from "./state.js";

function key(value: string) {
  const parsed = parseKeypress(Buffer.from(value));
  if (parsed === undefined) throw new Error("Unparsed key");
  return parsed;
}

describe("explorer narrow preview scrolling", () => {
  let state: ExplorerState;

  beforeEach(() => {
    const rows = Array.from({ length: 24 }, (_, index) => ({ id: String(index), title: `Row ${index + 1}` }));
    const content = Array.from({ length: 24 }, (_, index) => `Line ${index + 1}`).join("\n");
    state = step(createInitialState({
      title: "Rows",
      rows: async () => rows,
      detail: { items: async () => [] },
      actions: []
    }, { cols: 70, rows: 14 }), { type: "rowsLoaded", rows }).state;
    state = step(state, {
      type: "detailLoaded",
      rowId: "0",
      token: state.detail.token,
      items: [{ id: "body", renderedContent: content, render: () => content }]
    }).state;
  });

  it.each([60, 70, 79])("scrolls the focused full-height preview at %i columns", (cols) => {
    state = step(state, { type: "resize", cols, rows: 14 }).state;
    state = step(state, { type: "key", key: key("\t") }).state;
    expect(state.layout).toBe("narrow-list-only");
    expect(state.focused).toBe("detail");

    for (const [input, scroll] of [
      ["\u001b[B", 1], ["\u001b[A", 0],
      ["\u001b[6~", 8], ["\u001b[5~", 0],
      ["\u0004", 4], ["\u0015", 0]
    ] as const) {
      const result = step(state, { type: "key", key: key(input) });
      state = result.state;
      expect(state.detail.scroll).toBe(scroll);
      expect(state.cursor).toBe(0);
      expect(state.dirty).toBe(REGION_DETAIL);
      expect(result.effects).toEqual([]);
    }
  });

  it("clamps repeated pages at both ends and scrolls back by lines and half-pages", () => {
    state = step(state, { type: "key", key: key("\t") }).state;

    for (const [input, scroll] of [
      ["\u001b[6~", 8], ["\u001b[6~", 16], ["\u001b[6~", 16],
      ["\u001b[B", 16], ["\u0004", 16],
      ["\u001b[A", 15], ["\u0015", 11], ["\u001b[5~", 3], ["\u001b[5~", 0],
      ["\u001b[5~", 0], ["\u001b[A", 0], ["\u0015", 0]
    ] as const) {
      state = step(state, { type: "key", key: key(input) }).state;
      expect(state.detail.scroll).toBe(scroll);
      expect(state.cursor).toBe(0);
    }
  });

  it("preserves focused scroll when resizing from side-by-side to narrow preview", () => {
    state = step(state, { type: "resize", cols: 100, rows: 14 }).state;
    state = step(state, { type: "key", key: key("\t") }).state;
    state = step(state, { type: "key", key: key("\u001b[6~") }).state;
    expect(state.detail.scroll).toBe(8);

    state = step(state, { type: "resize", cols: 70, rows: 14 }).state;
    expect(state.focused).toBe("detail");
    expect(state.detail.scroll).toBe(8);
    state = step(state, { type: "resize", cols: 100, rows: 14 }).state;
    expect(state.detail.scroll).toBe(8);
  });

  it.each([
    [59, 14], [70, 7], [120, 7]
  ])("keeps detail scrolling disabled at %ix%i", (cols, rows) => {
    state = step(state, { type: "resize", cols: 100, rows: 14 }).state;
    state = step(state, { type: "key", key: key("\t") }).state;
    state = step(state, { type: "key", key: key("\u001b[6~") }).state;
    expect(state.detail.scroll).toBe(8);

    state = step(state, { type: "resize", cols, rows }).state;
    expect(state.layout).toBe("too-narrow");
    expect(state.detail.scroll).toBe(0);
    for (const input of ["\u001b[B", "\u001b[A", "\u001b[6~", "\u001b[5~", "\u0004", "\u0015"]) {
      state = step(state, { type: "key", key: key(input) }).state;
      expect(state.detail.scroll).toBe(0);
      expect(state.cursor).toBe(0);
    }
  });

  it.each([
    [80, 3], [99, 3], [100, 8], [120, 8]
  ])("preserves the %i-column preview page height of %i", (cols, height) => {
    state = step(state, { type: "resize", cols, rows: 14 }).state;
    state = step(state, { type: "key", key: key("\t") }).state;
    state = step(state, { type: "key", key: key("\u001b[6~") }).state;
    expect(state.detail.scroll).toBe(height);
    state = step(state, { type: "key", key: key("\u001b[5~") }).state;
    expect(state.detail.scroll).toBe(0);
    state = step(state, { type: "key", key: key("\u0004") }).state;
    expect(state.detail.scroll).toBe(Math.floor(height / 2));
    state = step(state, { type: "key", key: key("\u0015") }).state;
    expect(state.detail.scroll).toBe(0);
  });

  it("clamps a hidden narrow preview when the list is focused", () => {
    state = step(state, { type: "resize", cols: 100, rows: 14 }).state;
    state = step(state, { type: "key", key: key("\t") }).state;
    state = step(state, { type: "key", key: key("\u001b[6~") }).state;
    expect(state.detail.scroll).toBe(8);
    state = step(state, { type: "key", key: key("\t") }).state;

    state = step(state, { type: "resize", cols: 70, rows: 14 }).state;
    expect(state.focused).toBe("list");
    expect(state.detail.scroll).toBe(0);
  });

  it("keeps narrow list navigation separate from preview scrolling", () => {
    state = step(state, { type: "key", key: key("\t") }).state;
    state = step(state, { type: "key", key: key("\t") }).state;

    for (const [input, cursor] of [
      ["\u001b[B", 1], ["\u001b[6~", 8], ["\u0004", 11],
      ["\u001b[A", 10], ["\u001b[5~", 3], ["\u0015", 0]
    ] as const) {
      state = step(state, { type: "key", key: key(input) }).state;
      expect(state.focused).toBe("list");
      expect(state.cursor).toBe(cursor);
      expect(state.detail.scroll).toBe(0);
    }
  });
});
