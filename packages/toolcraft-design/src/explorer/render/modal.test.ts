import { describe, expect, it } from "vitest";
import { ScreenBuffer } from "../../dashboard/buffer.js";
import { REGION_ALL } from "../state.js";
import { renderModal } from "./modal.js";
import { fixtureState, renderStateSnapshot } from "./test-fixtures.js";

describe("explorer modal renderer", () => {
  it("snapshots modal overlays", () => {
    expect(renderStateSnapshot(fixtureState({ dirty: REGION_ALL, modal: { kind: "help" } }))).toMatchSnapshot("help modal");
    const state = fixtureState();
    const action = state.actionState.get("delete")!.action!;
    expect(renderStateSnapshot(fixtureState({
      dirty: REGION_ALL,
      modal: { kind: "confirm", action, rows: state.rows.slice(0, 2), resolver: () => undefined }
    }))).toMatchSnapshot("confirm modal");
    expect(renderStateSnapshot(fixtureState({
      dirty: REGION_ALL,
      modal: { kind: "palette", query: "del", cursor: 0 }
    }))).toMatchSnapshot("palette modal");
  });

  it("keeps wide palette text inside the modal border", () => {
    const state = fixtureState({
      modal: { kind: "palette", query: "修复🚀流程abcdefghijklmnopqrstuvwxyz", cursor: 0 }
    });
    const screen = new ScreenBuffer(36, 8);

    renderModal(state, screen);

    expect(screen.get(34, 2).ch).toBe("│");
  });
});
