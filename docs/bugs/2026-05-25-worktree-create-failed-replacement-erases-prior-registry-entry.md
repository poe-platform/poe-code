# Worktree Create Failed Replacement Erases Prior Registry Entry

## Summary

The exported `createWorktree()` operation treats a same-named worktree as replaceable cleanup state and removes its registry entry before attempting to create the requested replacement. If the new `git worktree add` step then fails, the operation rejects after the prior tracked entry has already been erased from the registry.

## Reproduction

Create the disposable probe `packages/worktree/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createWorktree } from "./create.js";
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

describe("createWorktree failed replacement", () => {
  it("erases the prior registry entry before new git worktree creation fails", async () => {
    const fs = createMemFs([
      "worktrees:",
      "  - name: feature",
      "    path: /repo/.worktrees/feature",
      "    branch: poe-code/feature",
      "    baseBranch: main",
      "    createdAt: '2026-05-24T00:00:00.000Z'",
      "    source: old",
      "    agent: codex",
      "    status: active",
      ""
    ].join("\n"));
    const exec = vi.fn(async (command: string) => {
      if (command.startsWith("git worktree add")) {
        throw new Error("base branch missing");
      }
      return { stdout: "", stderr: "" };
    });

    await expect(createWorktree({
      cwd: "/repo", name: "feature", baseBranch: "missing", source: "new",
      agent: "codex", registryFile: "/repo/worktrees.yaml", worktreeDir: "/repo/.worktrees",
      deps: { fs, exec }
    })).rejects.toThrowError("base branch missing");

    await expect(readRegistry("/repo/worktrees.yaml", fs)).resolves.toEqual({ worktrees: [] });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/worktree/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the prior registry entry is removed before replacement creation fails. Remove the disposable probe after running it.

## Observed Behavior

`createWorktree()` derives the replacement branch and path, runs best-effort removal of any prior Git worktree and branch, and then awaits `removeWorktreeEntry(...)` before attempting the new `git worktree add` at `packages/worktree/src/create.ts:20` through `packages/worktree/src/create.ts:33`. In the probe, the add command rejects with `base branch missing`, while `readRegistry()` afterwards returns `{ worktrees: [] }` instead of the pre-existing `feature` entry.

## Expected Behavior

Replacing an existing worktree should preserve coherent registry state if creation of the replacement fails. The operation should either retain/restorably transition the prior entry or record that its checkout was deliberately removed, rather than silently erasing known state before the replacement exists.

## Impact

A missing base branch, Git checkout conflict, or transient `git worktree add` failure during a rerun can remove the previous worktree from registry tracking while returning only the creation error. Users lose visibility into the prior lifecycle entry and cleanup history, and later commands cannot distinguish a clean absence from an interrupted replacement attempt.
