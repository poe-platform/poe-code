import { describe, expect, it } from "vitest";
import { ScreenBuffer } from "../../dashboard/buffer.js";
import { stripAnsi } from "../../internal/strip-ansi.js";
import { computeExplorerLayout } from "../layout.js";
import { resolveBindings } from "../keymap.js";
import { REGION_FOOTER } from "../state.js";
import { renderFooter } from "./footer.js";
import { dumpScreen, fixtureState, listDetailItems, renderStateSnapshot } from "./test-fixtures.js";
import { cellWidth } from "./text.js";

describe("explorer footer renderer", () => {
  it("snapshots footer states", () => {
    expect(renderStateSnapshot(fixtureState({ dirty: REGION_FOOTER, selected: new Set() }))).toMatchSnapshot("default footer");
    expect(renderStateSnapshot(fixtureState({ dirty: REGION_FOOTER }))).toMatchSnapshot("bulk footer");
    expect(renderStateSnapshot(fixtureState({
      dirty: REGION_FOOTER,
      focused: "detail",
      detail: { rowId: "27", items: listDetailItems(), cursor: 0, scroll: 0, token: 1, loading: false }
    }))).toMatchSnapshot("detail focused footer");
    const locked = fixtureState({ dirty: REGION_FOOTER });
    locked.actionState.get("delete")!.running = true;
    expect(renderStateSnapshot(locked)).toMatchSnapshot("running action footer");
  });

  it("surfaces the reorder keymap hint when reorder is configured", () => {
    const state = fixtureState({
      size: { cols: 160, rows: 14 },
      selected: new Set()
    });
    state.bindings = resolveBindings({
      title: "Tasks",
      rows: async () => [],
      detail: { items: async () => [] },
      actions: [],
      reorder: { onReorder: () => undefined }
    });
    const screen = new ScreenBuffer(160, 14);

    renderFooter(state, screen, computeExplorerLayout(state.size));

    expect(stripAnsi(dumpScreen(screen))).toContain("⇧↑↓ reorder (within state)");
  });

  it("replaces pane shortcuts with prompt controls while an overlay owns input", () => {
    const input = fixtureState({
      modal: {
        kind: "input",
        title: "Save plan",
        label: "Reason",
        value: "",
        resolver: () => undefined
      }
    });
    const confirm = fixtureState({
      modal: {
        kind: "confirm",
        title: "Confirm",
        message: "Continue?",
        confirmLabel: "Yes",
        cancelLabel: "No",
        destructive: false,
        resolver: () => undefined
      }
    });

    const inputFooter = stripAnsi(renderStateSnapshot(input)).split("\n").at(-1)!;
    const confirmFooter = stripAnsi(renderStateSnapshot(confirm)).split("\n").at(-1)!;

    expect(inputFooter).toContain("[Enter] submit");
    expect(inputFooter).not.toContain("actions");
    expect(confirmFooter).toContain("[Y/Enter] Yes");
    expect(confirmFooter).not.toContain("palette");
  });

  it("clips wide footer hints by terminal cells", () => {
    const state = fixtureState({
      size: { cols: 15, rows: 4 },
      selected: new Set()
    });
    state.actionState.get("edit")!.label = "修复🚀流程";
    const screen = new ScreenBuffer(15, 4);

    renderFooter(state, screen, computeExplorerLayout(state.size));

    const footer = stripAnsi(dumpScreen(screen)).split("\n").at(-1)!;
    expect(cellWidth(footer)).toBe(15);
    expect(footer).toContain("…");
  });
});
