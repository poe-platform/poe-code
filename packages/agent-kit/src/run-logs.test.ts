import { describe, expect, it } from "vitest";
import { makeRunLogFileName, resolveRunLogDir, slugifyPlanPath } from "./run-logs.js";

describe("slugifyPlanPath", () => {
  it("lowercases, strips the extension, and dasherizes the basename", () => {
    expect(slugifyPlanPath("/repo/docs/plans/My Feature.md")).toBe("my-feature");
  });

  it("preserves dashes and underscores", () => {
    expect(slugifyPlanPath("docs/plans/fix_auth-bug.md")).toBe("fix_auth-bug");
  });

  it("collapses runs of non-alphanumeric characters", () => {
    expect(slugifyPlanPath("docs/plans/weird  ??  name.md")).toBe("weird-name");
  });

  it("keeps digits", () => {
    expect(slugifyPlanPath("docs/plans/issue-1234.md")).toBe("issue-1234");
  });

  it("handles files without an extension", () => {
    expect(slugifyPlanPath("docs/plans/Plan")).toBe("plan");
  });
});

describe("resolveRunLogDir", () => {
  it("joins homeDir/.poe-code/logs/<runner>/<slug>", () => {
    expect(
      resolveRunLogDir({
        planPath: "/repo/docs/plans/My Feature.md",
        runner: "superintendent",
        homeDir: "/home/test"
      })
    ).toBe("/home/test/.poe-code/logs/superintendent/my-feature");
  });
});

describe("makeRunLogFileName", () => {
  it("formats as YYYYMMDD-HHMMSS-mmm-<role>.jsonl using UTC", () => {
    const date = new Date(Date.UTC(2026, 3, 18, 19, 50, 7, 123));
    expect(makeRunLogFileName("builder", date)).toBe("20260418-195007-123-builder.jsonl");
  });

  it("slugifies the role", () => {
    const date = new Date(Date.UTC(2026, 3, 18, 0, 0, 0, 0));
    expect(makeRunLogFileName("Inspector: Code Quality", date)).toBe(
      "20260418-000000-000-inspector-code-quality.jsonl"
    );
  });

  it("falls back to 'role' when the label is empty after slugification", () => {
    const date = new Date(Date.UTC(2026, 3, 18, 0, 0, 0, 0));
    expect(makeRunLogFileName("!!!", date)).toBe("20260418-000000-000-role.jsonl");
  });
});
