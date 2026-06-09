import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ensureSafeRunLogDir,
  makeRunLogFileName,
  resolveRunLogDir,
  slugifyPlanPath
} from "./run-logs.js";

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

  it("rejects runner names that escape the log root", () => {
    expect(() =>
      resolveRunLogDir({
        planPath: "/repo/docs/plans/review.md",
        runner: "../../../outside",
        homeDir: "/home/test"
      })
    ).toThrow("Runner must remain within the log root");
  });
});

describe("ensureSafeRunLogDir", () => {
  it("creates a default runner log directory inside the poe-code state directory", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "poe-run-logs-"));
    try {
      const logDir = await ensureSafeRunLogDir({
        planPath: "/repo/docs/plans/My Feature.md",
        runner: "pipeline",
        homeDir
      });

      expect(logDir).toBe(path.join(homeDir, ".poe-code/logs/pipeline/my-feature"));
      await expect(readdir(logDir)).resolves.toEqual([]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked logs ancestor outside the poe-code state directory", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "poe-run-logs-"));
    try {
      const stateDir = path.join(homeDir, ".poe-code");
      const outsideDir = path.join(homeDir, "outside");
      await mkdir(stateDir, { recursive: true });
      await mkdir(outsideDir, { recursive: true });
      await symlink(outsideDir, path.join(stateDir, "logs"));

      await expect(
        ensureSafeRunLogDir({
          planPath: "/repo/docs/plans/review.md",
          runner: "pipeline",
          homeDir
        })
      ).rejects.toThrow("Runner log directory resolves outside the poe-code state directory");
      await expect(readdir(outsideDir)).resolves.toEqual([]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked runner ancestor outside the poe-code state directory", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "poe-run-logs-"));
    try {
      const stateDir = path.join(homeDir, ".poe-code");
      const logRoot = path.join(stateDir, "logs");
      const outsideDir = path.join(homeDir, "outside");
      await mkdir(logRoot, { recursive: true });
      await mkdir(outsideDir, { recursive: true });
      await symlink(outsideDir, path.join(logRoot, "pipeline"));

      await expect(
        ensureSafeRunLogDir({
          planPath: "/repo/docs/plans/review.md",
          runner: "pipeline",
          homeDir
        })
      ).rejects.toThrow("Runner log directory resolves outside the poe-code state directory");
      await expect(readdir(outsideDir)).resolves.toEqual([]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
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
