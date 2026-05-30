---
name: "Worktree Remove Branch Delete Failure Keeps Deleted Checkout Registered"
---

# Worktree Remove Branch Delete Failure Keeps Deleted Checkout Registered

## Summary

The exported `removeWorktree()` operation removes the Git worktree before attempting optional branch deletion, but it only removes the registry entry after both Git commands succeed. If branch deletion fails after checkout removal has succeeded, the operation rejects while the registry still advertises a worktree path that has already been removed.

## Reproduction

Create the disposable probe `packages/worktree/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { removeWorktree } from "./remove.js";
import { readRegistry } from "./registry.js";
import type { WorktreeFileSystem } from "./types.js";

function createMemFs(initial: string): WorktreeFileSystem {
  let content = initial;
  return {
    async readFile() { return content; },
    async mkdir() {},
    async writeFile(_path, data) { content = data; }
  };
}

describe("removeWorktree branch deletion failure", () => {
  it("leaves a stale registry entry after the worktree was already removed", async () => {
    const fs = createMemFs([
      "worktrees:",
      "  - name: feature",
      "    path: /repo/.worktrees/feature",
      "    branch: poe-code/feature",
      "    baseBranch: main",
      "    createdAt: '2026-05-25T00:00:00.000Z'",
      "    source: test",
      "    agent: codex",
      "    status: active",
      ""
    ].join("\n"));
    const exec = vi.fn(async (command: string) => {
      if (command === "git branch -D poe-code/feature") {
        throw new Error("branch is checked out elsewhere");
      }
      return { stdout: "", stderr: "" };
    });

    await expect(removeWorktree({
      cwd: "/repo", name: "feature", registryFile: "/repo/worktrees.yaml",
      deleteBranch: true, deps: { fs, exec }
    })).rejects.toThrowError("branch is checked out elsewhere");

    await expect(readRegistry("/repo/worktrees.yaml", fs)).resolves.toMatchObject({
      worktrees: [{ name: "feature" }]
    });
    expect(exec).toHaveBeenNthCalledWith(1, "git worktree remove /repo/.worktrees/feature", { cwd: "/repo" });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/worktree/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming the stale registry is retained after the earlier checkout-removal side effect. Remove the disposable probe after running it.

## Observed Behavior

With `deleteBranch: true`, `removeWorktree()` first awaits `git worktree remove /repo/.worktrees/feature`, then awaits `git branch -D poe-code/feature` at `packages/worktree/src/remove.ts:20` through `packages/worktree/src/remove.ts:27`. When the second command rejects, execution never reaches `removeWorktreeEntry()` at `packages/worktree/src/remove.ts:30`; the registry continues to contain `feature` even though its checkout removal already succeeded.

## Expected Behavior

Registry state should accurately reflect that the checkout has been removed even if optional branch deletion fails, while surfacing the branch-cleanup failure separately. A failed optional cleanup step should not leave an authoritative entry pointing at a deleted worktree.

## Impact

A protected branch, concurrently checked-out branch, or transient Git branch deletion failure can make removal report failure while leaving stale worktree metadata behind. Subsequent listings and lifecycle operations operate on a nonexistent checkout, and retries can produce confusing secondary errors instead of clearly reporting that only branch cleanup remains.
