import { describe, expect, it } from "vitest";
import { interpolateVariables } from "./variables.js";

describe("interpolateVariables", () => {
  it("replaces {{ current_file }} with the doc path", () => {
    const result = interpolateVariables("Edit {{ current_file }} please", {
      current_file: "/repo/plans/plan.md"
    });

    expect(result).toBe("Edit /repo/plans/plan.md please");
  });

  it("replaces multiple occurrences of the same variable", () => {
    const result = interpolateVariables(
      "Open {{ current_file }} and review {{ current_file }}",
      { current_file: "/repo/plan.md" }
    );

    expect(result).toBe("Open /repo/plan.md and review /repo/plan.md");
  });

  it("handles multiple different variables", () => {
    const result = interpolateVariables(
      "File: {{ current_file }}, Dir: {{ cwd }}",
      { current_file: "/repo/plan.md", cwd: "/repo" }
    );

    expect(result).toBe("File: /repo/plan.md, Dir: /repo");
  });

  it("leaves unknown variables untouched", () => {
    const result = interpolateVariables("Hello {{ unknown_var }}", {
      current_file: "/repo/plan.md"
    });

    expect(result).toBe("Hello {{ unknown_var }}");
  });

  it("handles no variables in the template", () => {
    const result = interpolateVariables("No variables here", {
      current_file: "/repo/plan.md"
    });

    expect(result).toBe("No variables here");
  });

  it("handles empty template", () => {
    const result = interpolateVariables("", {
      current_file: "/repo/plan.md"
    });

    expect(result).toBe("");
  });

  it("handles whitespace variations in braces", () => {
    const result = interpolateVariables(
      "A {{current_file}} B {{ current_file }} C {{  current_file  }}",
      { current_file: "/repo/plan.md" }
    );

    expect(result).toBe("A /repo/plan.md B /repo/plan.md C /repo/plan.md");
  });
});
