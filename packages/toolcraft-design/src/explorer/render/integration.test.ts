import { describe, expect, it } from "vitest";
import { stripAnsi } from "../../internal/strip-ansi.js";
import { fixtureState, renderStateSnapshot } from "./test-fixtures.js";
import { cellWidth } from "./text.js";

describe("explorer render integration", () => {
  it("snapshots width breakpoints", () => {
    expect(renderStateSnapshot(fixtureState({ size: { cols: 120, rows: 16 } }))).toMatchSnapshot("wide");
    expect(renderStateSnapshot(fixtureState({ size: { cols: 100, rows: 14 } }))).toMatchSnapshot("medium");
    expect(renderStateSnapshot(fixtureState({ size: { cols: 80, rows: 16 } }))).toMatchSnapshot("narrow vertical");
    expect(renderStateSnapshot(fixtureState({ size: { cols: 60, rows: 12 } }))).toMatchSnapshot("list only");
    expect(renderStateSnapshot(fixtureState({ size: { cols: 50, rows: 10 } }))).toMatchSnapshot("too narrow");
    expect(renderStateSnapshot(fixtureState({ size: { cols: 70, rows: 12 } }))).toMatchSnapshot("70 column list collapse");
    expect(renderStateSnapshot(fixtureState({ size: { cols: 70, rows: 12 }, focused: "detail" }))).toMatchSnapshot("70 column detail collapse");
  });

  it("snapshots list plus list panes", () => {
    expect(
      renderStateSnapshot(
        fixtureState({
          paneDefinitions: [
            { id: "left", title: "Local", kind: "list" },
            { id: "right", title: "Remote", kind: "list" }
          ],
          detail: {
            rowId: "explorer",
            items: [
              { id: "remote-one", title: "Remote one", render: () => "" },
              { id: "remote-two", title: "Remote two", render: () => "" }
            ],
            cursor: 0,
            scroll: 0,
            token: 1,
            loading: false
          }
        })
      )
    ).toMatchSnapshot("list plus list");
  });

  it("clips wide toast text by terminal cells", () => {
    const output = stripAnsi(
      renderStateSnapshot(
        fixtureState({
          size: { cols: 12, rows: 4 },
          toast: { message: "修复🚀流程abcdef", tone: "info", expiresAt: 1 }
        })
      )
    );
    const toast = output.split("\n").at(-1)!;

    expect(cellWidth(toast)).toBe(12);
    expect(toast).toContain("…");
  });

  it("frames the wide list and detail panes with a visible gutter", () => {
    const output = stripAnsi(
      renderStateSnapshot(
        fixtureState({
          size: { cols: 120, rows: 16 }
        })
      )
    );

    expect(output).toContain("┌─ Plans ");
    expect(output).toContain("┌─ Preview ");
    expect(output).toContain("└");
    expect(output).toContain("┘");
    expect(output).toContain("┓ ┌─ Preview ");
  });

  it("uses the selected row to title the detail pane", () => {
    const output = stripAnsi(
      renderStateSnapshot(
        fixtureState({
          size: { cols: 120, rows: 16 },
          paneDefinitions: [
            { id: "plans", title: "Plans", kind: "list" },
            {
              id: "plan",
              title: "Plan",
              kind: "detail",
              titleForRow: () => "/repo/docs/plans/feature.md"
            }
          ]
        })
      )
    );

    expect(output).toContain("┌─ /repo/docs/plans/feature.md ");
    expect(output).not.toContain("┌─ Preview ");
  });
});
