import { describe, expect, it } from "vitest";
import { ScreenBuffer } from "../../dashboard/buffer.js";
import { stripAnsi } from "../../internal/strip-ansi.js";
import { REGION_ALL } from "../state.js";
import { renderModal } from "./modal.js";
import { dumpScreen, fixtureState, renderStateSnapshot } from "./test-fixtures.js";

describe("explorer modal renderer", () => {
  it("snapshots modal overlays", () => {
    expect(renderStateSnapshot(fixtureState({ dirty: REGION_ALL, modal: { kind: "help" } }))).toMatchSnapshot("help modal");
    const state = fixtureState();
    const action = state.actionState.get("delete")!.action!;
    expect(
      renderStateSnapshot(
        fixtureState({
          dirty: REGION_ALL,
          modal: {
            kind: "confirm",
            title: "Confirm destructive action",
            message: "Delete 2 items?",
            confirmLabel: "Delete",
            cancelLabel: "Cancel",
            destructive: true,
            action,
            rows: state.rows.slice(0, 2),
            resolver: () => undefined
          }
        })
      )
    ).toMatchSnapshot("confirm modal");
    expect(
      renderStateSnapshot(
        fixtureState({
          dirty: REGION_ALL,
          modal: { kind: "palette", query: "del", cursor: 0 }
        })
      )
    ).toMatchSnapshot("palette modal");
    expect(
      renderStateSnapshot(
        fixtureState({
          dirty: REGION_ALL,
          modal: {
            kind: "content",
            title: "Trace detail",
            content: ["one", "two", "three", "four"].join("\n"),
            scroll: 1
          }
        })
      )
    ).toMatchSnapshot("content modal");
    expect(
      stripAnsi(
        renderStateSnapshot(
          fixtureState({
            dirty: REGION_ALL,
            modal: {
              kind: "input",
              title: "Save plan",
              label: "Reason",
              value: "Blocked",
              resolver: () => undefined
            }
          })
        )
      )
    ).toContain("Blocked▌");
  });

  it("keeps wide palette text inside the modal border", () => {
    const state = fixtureState({
      modal: { kind: "palette", query: "修复🚀流程abcdefghijklmnopqrstuvwxyz", cursor: 0 }
    });
    const screen = new ScreenBuffer(36, 8);

    renderModal(state, screen);

    expect(screen.get(34, 2).ch).toBe("│");
  });

  it("renders scrolled content modal text inside the border", () => {
    const state = fixtureState({
      modal: {
        kind: "content",
        title: "Trace detail",
        content: ["zero", "one", "two", "three", "four"].join("\n"),
        scroll: 2
      }
    });
    const screen = new ScreenBuffer(36, 8);

    renderModal(state, screen);

    expect(dumpScreen(screen)).toContain("two");
    expect(dumpScreen(screen)).not.toContain("zero");
    expect(screen.get(34, 3).ch).toBe("│");
  });
});
