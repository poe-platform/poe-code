import { describe, expect, it } from "vitest";
import { resolveTemplate } from "./templates.js";

describe("resolveTemplate", () => {
  it("resolves {{plan.path}} correctly", () => {
    expect(resolveTemplate("Plan: {{plan.path}}", { plan: { path: "docs/plans/feature.md" } })).toBe(
      "Plan: docs/plans/feature.md"
    );
  });

  it("resolves {{builder.summary}} and {{builder.log}}", () => {
    expect(
      resolveTemplate("Summary: {{builder.summary}}\nLog: {{builder.log}}", {
        builder: {
          summary: "Implemented the feature",
          log: "line 1\nline 2"
        }
      })
    ).toBe("Summary: Implemented the feature\nLog: line 1\nline 2");
  });

  it("resolves {{inspectors.code-quality}} with hyphenated inspector names", () => {
    expect(
      resolveTemplate("Inspection: {{inspectors.code-quality}}", {
        inspectors: {
          "code-quality": "Looks good"
        }
      })
    ).toBe("Inspection: Looks good");
  });

  it("resolves {{superintendent.summary}} and {{owner.feedback}}", () => {
    expect(
      resolveTemplate("Superintendent: {{superintendent.summary}}\nOwner: {{owner.feedback}}", {
        superintendent: {
          summary: "Ready for owner review"
        },
        owner: {
          feedback: "Please add one more test"
        }
      })
    ).toBe("Superintendent: Ready for owner review\nOwner: Please add one more test");
  });

  it("leaves unknown variables as-is", () => {
    expect(
      resolveTemplate("Known: {{plan.path}} Unknown: {{builder.unknown}}", {
        plan: { path: "docs/plans/feature.md" }
      })
    ).toBe("Known: docs/plans/feature.md Unknown: {{builder.unknown}}");
  });

  it("supports surrounding whitespace inside placeholders", () => {
    expect(
      resolveTemplate("Plan: {{ plan.path }}\nInspector: {{ inspectors.code-quality }}", {
        plan: { path: "docs/plans/feature.md" },
        inspectors: { "code-quality": "Looks good" }
      })
    ).toBe("Plan: docs/plans/feature.md\nInspector: Looks good");
  });

  it("replaces repeated occurrences of the same variable", () => {
    expect(
      resolveTemplate("{{plan.path}} -> {{plan.path}}", {
        plan: { path: "docs/plans/feature.md" }
      })
    ).toBe("docs/plans/feature.md -> docs/plans/feature.md");
  });

  it("resolves empty string values", () => {
    expect(
      resolveTemplate("Owner: {{owner.feedback}}", {
        owner: { feedback: "" }
      })
    ).toBe("Owner: ");
  });

  it("handles templates with no variables", () => {
    expect(resolveTemplate("Nothing to interpolate here.", {})).toBe(
      "Nothing to interpolate here."
    );
  });

  it("handles multiple variables in one template", () => {
    expect(
      resolveTemplate(
        "Plan {{plan.path}}\nSummary {{builder.summary}}\nInspector {{inspectors.code-quality}}\nOwner {{owner.feedback}}",
        {
          plan: { path: "docs/plans/feature.md" },
          builder: { summary: "Builder done", log: "unused" },
          inspectors: { "code-quality": "No issues found" },
          owner: { feedback: "Approved" }
        }
      )
    ).toBe(
      "Plan docs/plans/feature.md\nSummary Builder done\nInspector No issues found\nOwner Approved"
    );
  });
});
