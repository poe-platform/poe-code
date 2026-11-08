import { describe, expect, it } from "vitest";
import { collectReferencedInspectors, resolveTemplate } from "./templates.js";

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
          log: "line 1\nline 2",
          log_path: "/tmp/spawn-logs/builder.jsonl"
        }
      })
    ).toBe("Summary: Implemented the feature\nLog: line 1\nline 2");
  });

  it("resolves {{builder.log_path}} to the spawn log file path", () => {
    expect(
      resolveTemplate("Replay: npm run replay -- {{builder.log_path}}", {
        builder: {
          summary: "done",
          log: "log",
          log_path: "/tmp/spawn-logs/20260415-120000-000-claude-code.jsonl"
        }
      })
    ).toBe("Replay: npm run replay -- /tmp/spawn-logs/20260415-120000-000-claude-code.jsonl");
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

  it("resolves {{superintendent.log_path}} to the superintendent spawn log path", () => {
    expect(
      resolveTemplate("Replay: npm run replay -- {{superintendent.log_path}}", {
        superintendent: {
          summary: "Ready for owner review",
          log_path: "/tmp/spawn-logs/20260419-120000-000-superintendent.jsonl"
        }
      })
    ).toBe("Replay: npm run replay -- /tmp/spawn-logs/20260419-120000-000-superintendent.jsonl");
  });

  it("resolves {{owner.log_path}} to the owner spawn log path", () => {
    expect(
      resolveTemplate("Replay: npm run replay -- {{owner.log_path}}", {
        owner: {
          feedback: "Please add one more test",
          log_path: "/tmp/spawn-logs/20260419-120000-000-owner.jsonl"
        }
      })
    ).toBe("Replay: npm run replay -- /tmp/spawn-logs/20260419-120000-000-owner.jsonl");
  });

  it("resolves {{inspector_logs.<name>}} to the named inspector's spawn log path", () => {
    expect(
      resolveTemplate(
        "Replay code-quality: {{inspector_logs.code-quality}}\nReplay manual-qa: {{inspector_logs.manual-qa}}",
        {
          inspector_logs: {
            "code-quality": "/tmp/spawn-logs/20260419-120000-000-inspector-code-quality.jsonl",
            "manual-qa": "/tmp/spawn-logs/20260419-120001-000-inspector-manual-qa.jsonl"
          }
        }
      )
    ).toBe(
      "Replay code-quality: /tmp/spawn-logs/20260419-120000-000-inspector-code-quality.jsonl\nReplay manual-qa: /tmp/spawn-logs/20260419-120001-000-inspector-manual-qa.jsonl"
    );
  });

  it("resolves unknown variables to an empty string", () => {
    expect(
      resolveTemplate("Known: {{plan.path}} Unknown: {{builder.unknown}}", {
        plan: { path: "docs/plans/feature.md" }
      })
    ).toBe("Known: docs/plans/feature.md Unknown: ");
  });

  it("resolves variables under a missing parent to an empty string", () => {
    expect(
      resolveTemplate("Log: {{superintendent.log_path}}", {
        plan: { path: "docs/plans/feature.md" }
      })
    ).toBe("Log: ");
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

  it("collects referenced inspector names including hyphenated ones and whitespace variants", () => {
    expect(
      collectReferencedInspectors(
        "Code: {{inspectors.code-quality}}\nQA: {{ inspectors.manual-qa }}\nNot matched: {{inspectors}}"
      )
    ).toEqual(new Set(["code-quality", "manual-qa"]));
  });

  it("returns an empty set when no inspectors are referenced", () => {
    expect(collectReferencedInspectors("Review {{builder.summary}}")).toEqual(new Set());
  });

  it("handles multiple variables in one template", () => {
    expect(
      resolveTemplate(
        "Plan {{plan.path}}\nSummary {{builder.summary}}\nInspector {{inspectors.code-quality}}\nOwner {{owner.feedback}}",
        {
          plan: { path: "docs/plans/feature.md" },
          builder: { summary: "Builder done", log: "unused", log_path: "/tmp/log.jsonl" },
          inspectors: { "code-quality": "No issues found" },
          owner: { feedback: "Approved" }
        }
      )
    ).toBe(
      "Plan docs/plans/feature.md\nSummary Builder done\nInspector No issues found\nOwner Approved"
    );
  });
});
