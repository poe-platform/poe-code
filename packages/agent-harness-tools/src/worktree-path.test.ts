import { describe, expect, it } from "vitest";
import { mapSourcePathIntoWorktree } from "./worktree-path.js";

describe("worktree path mapping", () => {
  it("maps repository-absolute paths while preserving relative and external paths", () => {
    expect(mapSourcePathIntoWorktree("/repo", "/repo/docs/plan.md", "/worktree")).toBe("/worktree/docs/plan.md");
    expect(mapSourcePathIntoWorktree("/repo", "docs/plan.md", "/worktree")).toBe("docs/plan.md");
    expect(mapSourcePathIntoWorktree("/repo", "/outside/plan.md", "/worktree")).toBe("/outside/plan.md");
    expect(mapSourcePathIntoWorktree("/repo", "/repo/..private/plan.md", "/worktree")).toBe("/worktree/..private/plan.md");
  });
});
