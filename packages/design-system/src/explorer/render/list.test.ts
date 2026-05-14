import { describe, expect, it } from "vitest";
import { REGION_LIST } from "../state.js";
import { fixtureState, renderStateSnapshot } from "./test-fixtures.js";

describe("explorer list renderer", () => {
  it("snapshots list states", () => {
    expect(renderStateSnapshot(fixtureState({ dirty: REGION_LIST }))).toMatchSnapshot("wide list");
    expect(renderStateSnapshot(fixtureState({ dirty: REGION_LIST, cursor: 3 }))).toMatchSnapshot("multi-select active");
    expect(renderStateSnapshot(fixtureState({ dirty: REGION_LIST, filter: "etu" }))).toMatchSnapshot("filter highlights");
    expect(renderStateSnapshot(fixtureState({ dirty: REGION_LIST, rows: [], filtered: [], selected: new Set() }))).toMatchSnapshot("empty list");
  });
});
