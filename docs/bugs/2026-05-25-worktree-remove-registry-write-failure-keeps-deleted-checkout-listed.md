# Worktree Remove Registry Write Failure Keeps Deleted Checkout Listed

## Summary

The exported `removeWorktree()` API removes the Git checkout before persisting removal of its registry entry. If writing the updated registry fails, the operation rejects after the checkout has already been deleted while the persisted registry can continue to list that removed worktree as active.

## Reproduction

Create the disposable probe `packages/worktree/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { removeWorktree } from "./remove.js";
import type { WorktreeFileSystem } from "./types.js";

describe("removeWorktree registry persistence failure", () => {
  it("rejects after removing the Git checkout when registry deletion cannot persist", async () => {
    const fs: WorktreeFileSystem = {
      async readFile() {
        return [
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
        ].join("\n");
      },
      async mkdir() {},
      async writeFile() { throw new Error("read-only filesystem"); }
    };
    const exec = vi.fn(async () => ({ stdout: "", stderr: "" }));

    await expect(removeWorktree({
      cwd: "/repo", name: "feature", registryFile: "/repo/worktrees.yaml", deps: { fs, exec }
    })).rejects.toThrowError("read-only filesystem");

    expect(exec).toHaveBeenCalledWith("git worktree remove /repo/.worktrees/feature", { cwd: "/repo" });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/worktree/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that Git checkout removal completes before failure to persist the updated registry is returned. Remove the disposable probe after running it.

## Observed Behavior

`removeWorktree()` first invokes `git worktree remove /repo/.worktrees/feature` at `packages/worktree/src/remove.ts:20` through `packages/worktree/src/remove.ts:23`, then invokes `removeWorktreeEntry()` at `packages/worktree/src/remove.ts:31`. That mutation attempts to persist the filtered registry through `writeRegistry()` at `packages/worktree/src/registry.ts:43` through `packages/worktree/src/registry.ts:50`. When `writeFile()` rejects, `removeWorktree()` rejects even though the Git worktree deletion has already succeeded, and the previously persisted registry entry remains available on disk.

## Expected Behavior

Worktree removal should keep the persisted registry coherent with completed Git side effects when registry storage fails, or arrange a recoverable transaction that avoids deleting the checkout before its registry deletion can be recorded. A rejected operation should not leave durable metadata claiming a deleted checkout still exists.

## Impact

A read-only state directory, quota failure, or transient write fault during removal can delete a working checkout while leaving stale active registry metadata. Users then see a removed worktree in later lists and may receive misleading failures when retrying cleanup or updating its status, obscuring that the destructive step already occurred.
