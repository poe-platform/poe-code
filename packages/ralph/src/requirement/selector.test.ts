import { describe, it, expect } from "vitest";
import { selectRequirement } from "./selector.js";
import type { Plan, Requirement } from "../plan/types.js";

function makePlan(requirements: Partial<Requirement>[]): Plan {
  return {
    version: 1,
    project: "test",
    goals: [],
    nonGoals: [],
    qualityGates: [],
    requirements: requirements.map((r, i) => ({
      id: r.id ?? `R-${i + 1}`,
      title: r.title ?? `Req ${i + 1}`,
      scenarios: r.scenarios ?? [],
      status: r.status ?? "pending",
      ...r
    })),
    stories: []
  };
}

describe("selectRequirement", () => {
  it("selects the first pending requirement", () => {
    const plan = makePlan([
      { id: "R-001", status: "pending" },
      { id: "R-002", status: "pending" }
    ]);

    const selected = selectRequirement(plan);
    expect(selected?.id).toBe("R-001");
  });

  it("skips passed requirements", () => {
    const plan = makePlan([
      { id: "R-001", status: "passed" },
      { id: "R-002", status: "pending" }
    ]);

    const selected = selectRequirement(plan);
    expect(selected?.id).toBe("R-002");
  });

  it("returns null when all requirements are passed", () => {
    const plan = makePlan([
      { id: "R-001", status: "passed" },
      { id: "R-002", status: "passed" }
    ]);

    const selected = selectRequirement(plan);
    expect(selected).toBeNull();
  });

  it("returns null for empty requirements", () => {
    const plan = makePlan([]);
    const selected = selectRequirement(plan);
    expect(selected).toBeNull();
  });

  it("re-selects a stale verifying requirement", () => {
    const plan = makePlan([
      { id: "R-001", status: "verifying" },
      { id: "R-002", status: "pending" }
    ]);

    const selected = selectRequirement(plan);
    expect(selected?.id).toBe("R-001");
  });

  it("selects failed requirements for retry", () => {
    const plan = makePlan([
      { id: "R-001", status: "failed" },
      { id: "R-002", status: "pending" }
    ]);

    const selected = selectRequirement(plan);
    expect(selected?.id).toBe("R-001");
  });

  it("skips ignored requirement ids", () => {
    const plan = makePlan([
      { id: "R-001", status: "pending" },
      { id: "R-002", status: "pending" }
    ]);

    const selected = selectRequirement(plan, { ignoreIds: new Set(["R-001"]) });
    expect(selected?.id).toBe("R-002");
  });

  it("returns null when all non-passed are ignored", () => {
    const plan = makePlan([
      { id: "R-001", status: "pending" },
      { id: "R-002", status: "passed" }
    ]);

    const selected = selectRequirement(plan, { ignoreIds: new Set(["R-001"]) });
    expect(selected).toBeNull();
  });
});
