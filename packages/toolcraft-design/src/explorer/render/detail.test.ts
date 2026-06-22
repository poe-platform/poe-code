import { describe, expect, it } from "vitest";
import { ScreenBuffer } from "../../dashboard/buffer.js";
import { stripAnsi } from "../../internal/strip-ansi.js";
import type { ExplorerLayout } from "../layout.js";
import { REGION_DETAIL } from "../state.js";
import { renderDetail } from "./detail.js";
import { fixtureState, listDetailItems, renderStateSnapshot } from "./test-fixtures.js";

describe("explorer detail renderer", () => {
  it("snapshots detail modes", () => {
    expect(renderStateSnapshot(fixtureState({ dirty: REGION_DETAIL }))).toMatchSnapshot(
      "single detail"
    );
    expect(
      renderStateSnapshot(
        fixtureState({
          dirty: REGION_DETAIL,
          focused: "detail",
          detail: {
            rowId: "27",
            items: listDetailItems(),
            cursor: 1,
            scroll: 0,
            token: 1,
            loading: false
          }
        })
      )
    ).toMatchSnapshot("list detail");
    expect(
      renderStateSnapshot(
        fixtureState({
          dirty: REGION_DETAIL,
          detail: { rowId: "27", items: null, cursor: 0, scroll: 0, token: 1, loading: true }
        })
      )
    ).toMatchSnapshot("loading detail");
    expect(
      renderStateSnapshot(
        fixtureState({
          dirty: REGION_DETAIL,
          detail: { rowId: "27", items: [], cursor: 0, scroll: 0, token: 1, loading: false }
        })
      )
    ).toMatchSnapshot("empty detail");
    expect(
      renderStateSnapshot(
        fixtureState({
          dirty: REGION_DETAIL,
          detail: {
            rowId: "27",
            items: [{ id: "error", render: () => "Error: detail failed" }],
            cursor: 0,
            scroll: 0,
            token: 1,
            loading: false
          }
        })
      )
    ).toMatchSnapshot("error detail");
  });

  it("clamps stale blob scroll before rendering", () => {
    const output = stripAnsi(
      renderStateSnapshot(
        fixtureState({
          dirty: REGION_DETAIL,
          size: { cols: 120, rows: 8 },
          focused: "detail",
          detail: {
            rowId: "27",
            items: [
              {
                id: "body",
                renderedContent: ["one", "two", "three", "four", "five", "six"].join("\n"),
                render: () => ""
              }
            ],
            cursor: 0,
            scroll: 99,
            token: 1,
            loading: false
          }
        })
      )
    );

    expect(output).toContain("five");
    expect(output).toContain("six");
  });

  it("clamps stale list scroll before rendering", () => {
    const output = stripAnsi(
      renderStateSnapshot(
        fixtureState({
          dirty: REGION_DETAIL,
          focused: "detail",
          detail: {
            rowId: "27",
            items: listDetailItems(),
            cursor: 1,
            scroll: 99,
            token: 1,
            loading: false
          }
        })
      )
    );

    expect(output).toContain("packages/auth/src/refresh.ts:88");
    expect(output).toContain("Rename t to token");
  });

  it("keeps wide blob lines inside the framed detail body", () => {
    const state = fixtureState({
      dirty: REGION_DETAIL,
      detail: {
        rowId: "27",
        items: [
          {
            id: "body",
            renderedContent: "修复🚀流程abcdef",
            render: () => ""
          }
        ],
        cursor: 0,
        scroll: 0,
        token: 1,
        loading: false
      }
    });
    const screen = new ScreenBuffer(10, 3);

    renderDetail(state, screen, detailLayout(10, 3));

    expect(screen.get(0, 0).ch).toBe("┌");
    expect(screen.get(0, 1).ch).toBe("│");
    expect(screen.get(6, 1).ch).toBe("🚀");
    expect(screen.get(8, 1).ch).toBe(" ");
    expect(screen.get(9, 1).ch).toBe("│");
  });

  it("renders markdown detail content through the terminal markdown renderer", () => {
    const output = stripAnsi(
      renderStateSnapshot(
        fixtureState({
          dirty: REGION_DETAIL,
          detail: {
            rowId: "27",
            items: [
              {
                id: "body",
                render: () =>
                  ["# Plan Preview", "", "- Render markdown", "", "```txt", "ship it", "```"].join(
                    "\n"
                  )
              }
            ],
            cursor: 0,
            scroll: 0,
            token: 1,
            loading: false
          }
        })
      )
    );

    expect(output).toContain("Plan Preview");
    expect(output).toContain("• Render markdown");
    expect(output).toContain("ship it");
    expect(output).not.toContain("# Plan Preview");
    expect(output).not.toContain("```txt");
  });
});

function detailLayout(width: number, height = 1): ExplorerLayout {
  return {
    mode: "medium",
    header: { x: 0, y: 0, width: 0, height: 0 },
    list: { x: 0, y: 0, width: 0, height: 0 },
    detail: { x: 0, y: 0, width, height },
    footer: { x: 0, y: height, width: 0, height: 0 }
  };
}
