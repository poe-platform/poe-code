import { describe, expect, it } from "vitest";
import { fixtureState, renderStateSnapshot } from "./test-fixtures.js";

describe("explorer render integration", () => {
  it("snapshots width breakpoints", () => {
    expect(renderStateSnapshot(fixtureState({ size: { cols: 120, rows: 16 } }))).toMatchSnapshot("wide");
    expect(renderStateSnapshot(fixtureState({ size: { cols: 100, rows: 14 } }))).toMatchSnapshot("medium");
    expect(renderStateSnapshot(fixtureState({ size: { cols: 80, rows: 16 } }))).toMatchSnapshot("narrow vertical");
    expect(renderStateSnapshot(fixtureState({ size: { cols: 60, rows: 12 } }))).toMatchSnapshot("list only");
  });
});
