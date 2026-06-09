import { describe, expect, it } from "vitest";
import { ScreenBuffer } from "../../dashboard/buffer.js";
import { stripAnsi } from "../../internal/strip-ansi.js";
import type { ExplorerLayout } from "../layout.js";
import { REGION_HEADER } from "../state.js";
import { renderHeader } from "./header.js";
import { dumpScreen, fixtureState, renderStateSnapshot } from "./test-fixtures.js";
import { cellWidth } from "./text.js";

describe("explorer header renderer", () => {
  it("snapshots header states", () => {
    expect(renderStateSnapshot(fixtureState({ dirty: REGION_HEADER, filter: "", selected: new Set() }))).toMatchSnapshot("empty filter");
    expect(renderStateSnapshot(fixtureState({ dirty: REGION_HEADER, filter: "auth" }))).toMatchSnapshot("typed filter");
    expect(renderStateSnapshot(fixtureState({
      dirty: REGION_HEADER,
      filter: "tui",
      detail: { rowId: "27", items: null, cursor: 0, scroll: 0, token: 1, loading: true }
    }))).toMatchSnapshot("count and spinner");
  });

  it("keeps wide titles inside the top border", () => {
    const state = fixtureState({
      title: "计划🚀看板",
      size: { cols: 12, rows: 3 },
      dirty: REGION_HEADER
    });
    const screen = new ScreenBuffer(12, 3);

    renderHeader(state, screen, headerLayout(12));

    const [top] = stripAnsi(dumpScreen(screen)).split("\n");
    expect(top).toBeDefined();
    expect(cellWidth(top!)).toBe(12);
    expect(screen.get(11, 0).ch).toBe("┐");
  });
});

function headerLayout(width: number): ExplorerLayout {
  return {
    mode: "medium",
    header: { x: 0, y: 0, width, height: 3 },
    list: { x: 0, y: 3, width: 0, height: 0 },
    detail: { x: 0, y: 3, width: 0, height: 0 },
    footer: { x: 0, y: 3, width: 0, height: 0 }
  };
}
