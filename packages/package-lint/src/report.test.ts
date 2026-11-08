import { describe, expect, it } from "vitest";
import { formatReport } from "./report.js";

describe("formatReport", () => {
  it("does not claim every rule passed when some were skipped", () => {
    const report = formatReport(
      {
        summary: { packages: 0, rules: 2, violations: 0, ok: true },
        evaluated: ["bundle-self-contained", "public-needs-publish-wiring"],
        violations: [],
        skipped: ["bundle-self-contained"]
      },
      { json: false, quiet: false }
    );

    expect(report).toContain("1 rules passed");
    expect(report).toContain("1 skipped");
    expect(report).not.toContain("all 2 rules passed");
  });
});
