import { describe, expect, it } from "vitest";
import { ScreenBuffer } from "../../dashboard/buffer.js";
import { stripAnsi } from "../../internal/strip-ansi.js";
import type { ExplorerLayout } from "../layout.js";
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
    expect(screen.get(17, 1).ch).toBe("│");
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
