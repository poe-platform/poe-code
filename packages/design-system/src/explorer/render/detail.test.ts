import { describe, expect, it } from "vitest";
import { REGION_DETAIL } from "../state.js";
import { fixtureState, listDetailItems, renderStateSnapshot } from "./test-fixtures.js";

describe("explorer detail renderer", () => {
  it("snapshots detail modes", () => {
    expect(renderStateSnapshot(fixtureState({ dirty: REGION_DETAIL }))).toMatchSnapshot("single detail");
    expect(renderStateSnapshot(fixtureState({
      dirty: REGION_DETAIL,
      focused: "detail",
      detail: { rowId: "27", items: listDetailItems(), cursor: 1, scroll: 0, token: 1, loading: false }
    }))).toMatchSnapshot("list detail");
    expect(renderStateSnapshot(fixtureState({
      dirty: REGION_DETAIL,
      detail: { rowId: "27", items: null, cursor: 0, scroll: 0, token: 1, loading: true }
    }))).toMatchSnapshot("loading detail");
    expect(renderStateSnapshot(fixtureState({
      dirty: REGION_DETAIL,
      detail: { rowId: "27", items: [], cursor: 0, scroll: 0, token: 1, loading: false }
    }))).toMatchSnapshot("empty detail");
    expect(renderStateSnapshot(fixtureState({
      dirty: REGION_DETAIL,
      detail: {
        rowId: "27",
        items: [{ id: "error", render: () => "Error: detail failed" }],
        cursor: 0,
        scroll: 0,
        token: 1,
        loading: false
      }
    }))).toMatchSnapshot("error detail");
  });
});
