import { describe, expect, it } from "vitest";

import { createTask } from "../__test_utils__/index.js";
import { resolveWorkflowKind } from "./kind.js";

describe("resolveWorkflowKind", () => {
  it("returns pipeline when frontmatter is absent", () => {
    expect(
      resolveWorkflowKind(
        createTask({
          sourcePath: "/repo/docs/plans/pipeline.md",
          description: "# Plan\n\nShip the work."
        })
      )
    ).toBe("pipeline");
  });

  it("returns the explicit kind value when present", () => {
    expect(
      resolveWorkflowKind(
        createTask({
          sourcePath: "/repo/docs/plans/ralph.md",
          description: ["---", "kind: ralph", "version: 1", "---", "", "# Plan"].join("\n")
        })
      )
    ).toBe("ralph");
  });

  it("returns the metadata kind parsed from file-backed task frontmatter", () => {
    expect(
      resolveWorkflowKind(
        createTask({
          sourcePath: "/repo/docs/plans/ralph.md",
          description: "# Plan\n\nRun the loop.",
          metadata: { kind: "ralph" }
        })
      )
    ).toBe("ralph");
  });

  it("uses YAML frontmatter whitespace handling and preserves casing", () => {
    expect(
      resolveWorkflowKind(
        createTask({
          sourcePath: "/repo/docs/plans/ralph.md",
          description: ["---", "kind:   RaLpH   ", "---", "", "# Plan"].join("\n")
        })
      )
    ).toBe("RaLpH");
  });

  it("returns pipeline for tasks without a description", () => {
    expect(
      resolveWorkflowKind(
        createTask({
          description: "",
          metadata: { kind: "ralph" }
        })
      )
    ).toBe("pipeline");
  });

  it("returns pipeline for gh-issues even when the issue body looks like frontmatter", () => {
    expect(
      resolveWorkflowKind(
        createTask({
          description: ["---", "kind: ralph", "---", "", "# Issue"].join("\n"),
          metadata: { kind: "ralph" }
        })
      )
    ).toBe("pipeline");
  });
});
