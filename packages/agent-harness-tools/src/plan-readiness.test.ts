import { describe, expect, it } from "vitest";
import { comparePlanReadiness, formatPlanReadinessLabel } from "./plan-readiness.js";

describe("plan readiness presentation", () => {
  it("adds the plan-viewer checkmark only to ready plans", () => {
    expect(formatPlanReadinessLabel("docs/plans/ready.md", "ready")).toBe(
      "docs/plans/ready.md ✓"
    );
    expect(formatPlanReadinessLabel("docs/plans/draft.md", "draft")).toBe(
      "docs/plans/draft.md"
    );
  });

  it("sorts ready plans ahead of drafts", () => {
    expect(comparePlanReadiness({ readiness: "ready" }, { readiness: "draft" })).toBeLessThan(0);
    expect(comparePlanReadiness({ readiness: "draft" }, { readiness: "ready" })).toBeGreaterThan(0);
    expect(comparePlanReadiness({ readiness: "ready" }, { readiness: "ready" })).toBe(0);
  });
});
