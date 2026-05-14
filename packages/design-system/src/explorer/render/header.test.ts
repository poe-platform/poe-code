import { describe, expect, it } from "vitest";
import { REGION_HEADER } from "../state.js";
import { fixtureState, renderStateSnapshot } from "./test-fixtures.js";

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
});
