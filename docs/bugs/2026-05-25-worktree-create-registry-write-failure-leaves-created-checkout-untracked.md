---
name: "Worktree Create Registry Write Failure Leaves Created Checkout Untracked"
---

# Worktree Create Registry Write Failure Leaves Created Checkout Untracked

## Summary

The exported `createWorktree()` API successfully creates a Git worktree before persisting its registry entry. If the subsequent registry write fails, the operation rejects without attempting to remove the already-created checkout or branch, leaving a live worktree that the package registry does not track.

## Reproduction

Create the disposable probe `packages/worktree/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createWorktree } from "./create.js";
import type { WorktreeFileSystem } from "./types.js";

describe("createWorktree registry persistence failure", () => {
  it("rejects after creating the Git worktree without cleanup when registry write fails", async () => {
    const fs: WorktreeFileSystem = {
      async readFile() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
      async mkdir() {},
      async writeFile() { throw new Error("disk full"); }
    };
    const exec = vi.fn(async () => ({ stdout: "", stderr: "" }));

    await expect(createWorktree({
      cwd: "/repo", name: "feature", baseBranch: "main", source: "test", agent: "codex",
      registryFile: "/repo/.poe-code/worktrees.yaml", worktreeDir: "/repo/.worktrees", deps: { fs, exec }
    })).rejects.toThrowError("disk full");

    expect(exec.mock.calls.map(([command]) => command)).toContain(
      "git worktree add -b poe-code/feature /repo/.worktrees/feature main"
    );
    expect(exec.mock.calls.map(([command]) => command).filter((command) => String(command).includes("worktree remove")))
      .toEqual(["git worktree remove /repo/.worktrees/feature --force"]);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/worktree/src/__probe__.test.ts --reporter verbose
```

The probe passes, proving that no post-creation rollback worktree-removal command is issued after registry persistence fails. Remove the disposable probe after running it.

## Observed Behavior

`createWorktree()` executes `git worktree add -b poe-code/feature /repo/.worktrees/feature main` at `packages/worktree/src/create.ts:34` through `packages/worktree/src/create.ts:37`, then awaits `addWorktreeEntry(...)` at `packages/worktree/src/create.ts:53`. When `writeRegistry()` rejects through `packages/worktree/src/registry.ts:23` through `packages/worktree/src/registry.ts:30`, `createWorktree()` rejects immediately and performs no rollback after the successful add. The only `git worktree remove` command observed is the pre-create cleanup attempt made before the new checkout exists.

## Expected Behavior

Once Git worktree creation succeeds, any failure persisting the new registry entry should trigger best-effort cleanup of the newly created checkout and branch, or otherwise return enough tracked recovery state to manage it. The API should not reject while leaving newly materialized state invisible to its own registry.

## Impact

A disk-full event, permission change, or registry storage failure can create a working checkout and branch while reporting only a failed creation operation. Subsequent `listWorktrees()` calls cannot identify the orphaned worktree from registry state, and retries or cleanup commands can conflict with an unmanaged checkout left on disk and registered with Git.
