import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseKeypress } from "../dashboard/terminal.js";
import { step } from "./reducer.js";
import { createInitialState, type ExplorerState, type Row } from "./state.js";

const rows: Row[] = [
  { id: "alpha", title: "Alpha" },
  { id: "alpine", title: "Alpine" }
];

function key(value: string) {
  const parsed = parseKeypress(Buffer.from(value));
  if (parsed === undefined) throw new Error("Unparsed key");
  return parsed;
}

describe.each([
  { surface: "main filter", value: (state: ExplorerState) => state.filter },
  { surface: "focused filter", value: (state: ExplorerState) => state.filter },
  { surface: "second-list filter", value: (state: ExplorerState) => state.detail.filter ?? "" },
  {
    surface: "modal input",
    value: (state: ExplorerState) => (state.modal?.kind === "input" ? state.modal.value : undefined)
  },
  {
    surface: "palette query",
    value: (state: ExplorerState) =>
      state.modal?.kind === "palette" ? state.modal.query : undefined
  }
])("Explorer grapheme Backspace: $surface", ({ surface, value }) => {
  let state: ExplorerState;
  let resolver: ReturnType<typeof vi.fn>;
  let handler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resolver = vi.fn();
    handler = vi.fn();
    state = step(
      createInitialState(
        {
          title: "Rows",
          panes: [
            { id: "first", title: "First", kind: "list", rows: async () => rows },
            { id: "second", title: "Second", kind: "list", rows: async () => rows }
          ],
          actions: rows.map((row) => ({ id: row.id, label: row.title, handler }))
        },
        { cols: 120, rows: 20 }
      ),
      { type: "rowsLoaded", rows }
    ).state;

    if (surface === "focused filter") {
      state = { ...state, filterFocused: true };
    } else if (surface === "second-list filter") {
      state = step(state, {
        type: "detailLoaded",
        rowId: "alpha",
        token: state.detail.token,
        items: rows.map((row) => ({ ...row, render: () => "" }))
      }).state;
      state = step(state, { type: "key", key: key("\t") }).state;
    } else if (surface === "modal input") {
      state = {
        ...state,
        modal: { kind: "input", title: "Save", label: "Name", value: "", resolver }
      };
    } else if (surface === "palette query") {
      state = step(state, { type: "key", key: key("\u0010") }).state;
    }
  });

  it.each([
    { label: "emoji", input: "😀", remaining: [""] },
    { label: "combining mark", input: "e\u0301", remaining: [""] },
    { label: "ZWJ sequence", input: "👩‍💻", remaining: [""] },
    { label: "flag", input: "🇺🇸", remaining: [""] },
    { label: "skin tone", input: "👍🏽", remaining: [""] },
    { label: "mixed ASCII and emoji", input: "a😀b", remaining: ["a😀", "a", ""] },
    { label: "ASCII", input: "ab", remaining: ["a", ""] },
    { label: "empty input", input: "", remaining: [""] }
  ])("deletes one whole grapheme from $label", ({ input, remaining }) => {
    for (const character of input) {
      state = step(state, { type: "key", key: key(character) }).state;
    }
    expect(value(state)).toBe(input);
    if (input !== "") {
      if (surface === "main filter" || surface === "focused filter") {
        expect(state.filtered).toEqual([]);
      } else if (surface === "second-list filter") {
        expect(state.detail.items).toEqual([]);
      }
    }

    for (const expected of remaining) {
      if (expected === "" && state.modal?.kind === "palette") {
        state = { ...state, modal: { ...state.modal, cursor: 99 } };
      }
      state = step(state, { type: "key", key: key("\u007f") }).state;
      expect(value(state)).toBe(expected);
    }

    if (surface === "main filter" || surface === "focused filter") {
      expect(state.filtered).toEqual([0, 1]);
      expect(state.cursor).toBe(0);
    } else if (surface === "second-list filter") {
      expect(state.detail.items?.map((item) => item.id)).toEqual(["alpha", "alpine"]);
      expect(state.detail.cursor).toBe(0);
      expect(state.filter).toBe("");
    } else if (surface === "modal input") {
      expect(resolver).not.toHaveBeenCalled();
      const submitted = step(state, { type: "key", key: key("\r") });
      expect(submitted.state.modal).toBeNull();
      expect(submitted.effects).toEqual([]);
      expect(resolver).toHaveBeenCalledExactlyOnceWith("");
    } else {
      expect(state.modal).toEqual({ kind: "palette", query: "", cursor: 1 });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps Ctrl+H ignored and the Delete sequence mapped to Backspace", () => {
    state = step(state, { type: "key", key: key("😀") }).state;
    const ignored = step(state, { type: "key", key: key("\u0008") });
    expect(value(ignored.state)).toBe("😀");
    expect(ignored.effects).toEqual([]);

    const deleted = step(ignored.state, { type: "key", key: key("\u001b[3~") });
    expect(value(deleted.state)).toBe("");
    expect(resolver).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
