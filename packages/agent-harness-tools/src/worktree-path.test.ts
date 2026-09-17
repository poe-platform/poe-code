import { describe, expect, it } from "vitest";
import { mapSourcePathIntoWorktree } from "./worktree-path.js";

describe("worktree path mapping", () => {
  it("does not remap paths that are already in a worktree nested inside the repository", () => {
    const worktree = "/repo/.poe-code/worktrees/run";
    const plan = `${worktree}/docs/plan.md`;
    expect(mapSourcePathIntoWorktree("/repo", plan, worktree)).toBe(plan);
    expect(mapSourcePathIntoWorktree("/repo", worktree, worktree)).toBe(worktree);
  });

  it("maps repository-absolute paths while preserving relative and external paths", () => {
    expect(mapSourcePathIntoWorktree("/repo", "/repo/docs/plan.md", "/worktree")).toBe("/worktree/docs/plan.md");
    expect(mapSourcePathIntoWorktree("/repo", "docs/plan.md", "/worktree")).toBe("docs/plan.md");
    expect(mapSourcePathIntoWorktree("/repo", "/outside/plan.md", "/worktree")).toBe("/outside/plan.md");
    expect(mapSourcePathIntoWorktree("/repo", "/repo/..private/plan.md", "/worktree")).toBe("/worktree/..private/plan.md");
  });
});
