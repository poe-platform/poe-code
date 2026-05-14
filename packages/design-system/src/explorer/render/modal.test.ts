import { describe, expect, it } from "vitest";
import { REGION_ALL } from "../state.js";
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
});
