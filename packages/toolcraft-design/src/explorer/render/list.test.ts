import { describe, expect, it } from "vitest";
import { ScreenBuffer } from "../../dashboard/buffer.js";
import { stripAnsi } from "../../internal/strip-ansi.js";
import type { ExplorerLayout } from "../layout.js";
import { step } from "../reducer.js";
import { REGION_LIST } from "../state.js";
import { renderList } from "./list.js";
import { dumpScreen, fixtureState, renderStateSnapshot } from "./test-fixtures.js";
import { cellWidth } from "./text.js";

describe("explorer list renderer", () => {
  it("snapshots list states", () => {
    expect(renderStateSnapshot(fixtureState({ dirty: REGION_LIST }))).toMatchSnapshot("wide list");
    expect(renderStateSnapshot(fixtureState({ dirty: REGION_LIST, cursor: 3 }))).toMatchSnapshot(
      "multi-select active"
    );
    expect(
      renderStateSnapshot(fixtureState({ dirty: REGION_LIST, filter: "etu" }))
    ).toMatchSnapshot("filter highlights");
    expect(
      renderStateSnapshot(
        fixtureState({ dirty: REGION_LIST, rows: [], filtered: [], selected: new Set() })
      )
    ).toMatchSnapshot("empty list");
  });

  it("keeps wide row titles inside the badge and focus columns", () => {
    const state = fixtureState({
      rows: [
        {
          id: "wide",
          title: "修复🚀流程abcdef",
          badge: { text: "火", tone: "info" }
        }
      ],
      filtered: [0],
      matchPositions: new Map([[0, [0, 1, 2, 3]]]),
      selected: new Set()
    });
    const screen = new ScreenBuffer(18, 3);

    renderList(state, screen, listLayout(18, 3));

    const output = stripAnsi(dumpScreen(screen));
    const row = output.split("\n")[1]!;
    expect(row).toContain("修复… 火 ▌");
    expect(cellWidth(row)).toBe(18);
    expect(screen.get(12, 1).ch).toBe("火");
    expect(screen.get(13, 1).ch).toBe("");
    expect(screen.get(15, 1).ch).toBe("▌");
    expect(screen.get(17, 1).ch).toBe("┃");
  });

  it("renders group headers as horizontal separators", () => {
    const state = fixtureState({
      rows: [
        { id: "active", title: "Active plan", group: "Active" },
        { id: "saved", title: "Saved plan", group: "Saved for later" }
      ],
      filtered: [0, 1],
      selected: new Set()
    });
    const screen = new ScreenBuffer(36, 8);

    renderList(state, screen, listLayout(36, 8));

    const output = stripAnsi(dumpScreen(screen));
    expect(output).toContain(" Active ─");
    expect(output).toContain(" Saved for later ─");
  });

  it("keeps the cursor row visible when the cursor is below the first page", () => {
    const state = fixtureState({
      rows: Array.from({ length: 30 }, (_, index) => ({
        id: `row-${index}`,
        title: `Row ${index}`
      })),
      filtered: Array.from({ length: 30 }, (_, index) => index),
      cursor: 20,
      selected: new Set()
    });
    const screen = new ScreenBuffer(36, 8);

    renderList(state, screen, listLayout(36, 8));

    const output = stripAnsi(dumpScreen(screen));
    expect(output).toContain("● Row 20");
    expect(output).not.toContain("● Row 0");
  });

  it("filters surrogate-fragment false positives before rendering highlights", () => {
    const initial = fixtureState({
      rows: [{ id: "no", title: "😁🈀" }, { id: "yes", title: "😀" }],
      rowsLoading: false,
      selected: new Set()
    });
    const { state } = step(initial, {
      type: "key", key: { ch: "😀", ctrl: false, meta: false, shift: false }
    });
    const screen = new ScreenBuffer(36, 5);

    renderList(state, screen, listLayout(36, 5));

    expect(state.filtered).toEqual([1]);
    expect(state.matchPositions.get(1)).toEqual([0, 1]);
    const output = stripAnsi(dumpScreen(screen));
    expect(output).toContain("1/2");
    expect(output).toContain("😀");
    expect(output).not.toContain("😁");
    expect(output).not.toContain("🈀");
    const cells = Array.from({ length: screen.width }, (_, index) => screen.get(index, 1));
    expect(cells.filter((cell) => cell.ch && cell.style.underline).map((cell) => cell.ch)).toEqual(["😀"]);
  });

  it.each([
    ["😀", "A😀B", "😀", [1, 2]],
    ["B", "😀B", "B", [2]],
    ["👩💻", "👩‍💻", "👩‍💻", [0, 1, 3, 4]]
  ] as const)("highlights %s using UTF-16 spans in %s", (filter, title, highlighted, positions) => {
    const state = fixtureState({ rows: [{ id: "match", title }], filter, selected: new Set() });
    const screen = new ScreenBuffer(36, 3);

    renderList(state, screen, listLayout(36, 3));

    expect(state.matchPositions.get(0)).toEqual(positions);
    const cells = Array.from({ length: screen.width }, (_, index) => screen.get(index, 1));
    expect(cells.filter((cell) => cell.ch && cell.style.underline).map((cell) => cell.ch)).toEqual([highlighted]);
    expect(stripAnsi(dumpScreen(screen))).toContain(title);
  });
});

function listLayout(width: number, height = 1): ExplorerLayout {
  return {
    mode: "medium",
    header: { x: 0, y: 0, width: 0, height: 0 },
    list: { x: 0, y: 0, width, height },
    detail: { x: 0, y: height, width: 0, height: 0 },
    footer: { x: 0, y: height, width: 0, height: 0 }
  };
}
