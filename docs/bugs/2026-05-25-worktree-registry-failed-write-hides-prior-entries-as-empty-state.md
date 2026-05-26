# Worktree Registry Failed Write Hides Prior Entries as Empty State

## Summary

The exported `@poe-code/worktree` registry overwrites its live YAML document directly and silently converts any later parse/read failure into an empty registry. If an update partially corrupts the registry before rejecting, existing tracked worktrees disappear from subsequent API reads as though no worktrees had ever been recorded.

## Reproduction

Create a disposable Vitest probe at `packages/worktree/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { addWorktreeEntry, readRegistry } from "./registry.js";
import type { WorktreeFileSystem } from "./types.js";

describe("worktree registry interrupted overwrite", () => {
  it("resolves future reads as empty after a rejected write corrupts existing registry", async () => {
    const registryFile = "/repo/.poe-code/worktrees.yaml";
    const base = createFsFromVolume(Volume.fromJSON({
      [registryFile]: "worktrees:\n  - name: old\n    path: /repo/.worktrees/old\n    branch: old\n    status: active\n",
    })).promises as unknown as WorktreeFileSystem;
    const fs: WorktreeFileSystem = {
      ...base,
      async writeFile(filePath, data, options) {
        if (filePath === registryFile) {
          await base.writeFile(filePath, "worktrees: [", options);
          throw new Error("registry disk full");
        }
        await base.writeFile(filePath, data, options);
      },
    };

    await expect(addWorktreeEntry(registryFile, {
      name: "new", path: "/repo/.worktrees/new", branch: "new", baseBranch: "main",
      createdAt: "2026-05-25T00:00:00.000Z", source: "probe", agent: "codex", status: "active",
    }, fs)).rejects.toThrow("registry disk full");
    const raw = await base.readFile(registryFile, "utf8");
    const registry = await readRegistry(registryFile, base);
    console.log(JSON.stringify({ raw, registry }));
    expect(raw).toBe("worktrees: [");
    expect(registry).toEqual({ worktrees: [] });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/worktree/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"worktrees: [","registry":{"worktrees":[]}}
✓ packages/worktree/src/__probe__.test.ts > worktree registry interrupted overwrite > resolves future reads as empty after a rejected write corrupts existing registry
```

Remove the disposable probe after validation.

## Observed Behavior

`readRegistry()` catches parsing and read failures and returns `{ worktrees: [] }` at `packages/worktree/src/registry.ts:10`. `writeRegistry()` serializes and overwrites the live registry file directly at `packages/worktree/src/registry.ts:23`, and mutation paths such as `addWorktreeEntry()` use it without staging or rollback at `packages/worktree/src/registry.ts:33`. In the probe, a rejected add leaves malformed YAML on disk; the next read silently reports an empty registry instead of the previously stored `old` worktree.

## Expected Behavior

Registry updates should preserve the last valid worktree list when a replacement write fails, and malformed persisted registry data should be surfaced as recoverable corruption rather than silently represented as an empty authoritative state.

## Impact

A storage interruption while adding, removing, or updating one worktree can hide every previously tracked worktree from listing and cleanup operations. Active working directories and branches may become orphaned or recreated inconsistently because the API reports no registry entries while corrupted state remains on disk.
