import { describe, expect, it } from "vitest";
import { REGION_FOOTER } from "../state.js";
import { fixtureState, listDetailItems, renderStateSnapshot } from "./test-fixtures.js";

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
});
