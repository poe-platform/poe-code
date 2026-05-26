# Worktree Registry Transient Read Error Causes Successful Update to Erase Existing Entries

## Summary

The exported `@poe-code/worktree` registry treats every registry read failure as an empty registry, not only a missing file. If an existing valid registry is temporarily unreadable during `addWorktreeEntry()`, the operation succeeds by writing only the new entry, silently erasing all previously tracked worktrees.

## Reproduction

Create a disposable Vitest probe at `packages/worktree/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { addWorktreeEntry, readRegistry } from "./registry.js";
import type { WorktreeFileSystem } from "./types.js";

describe("worktree registry transient read failure", () => {
  it("overwrites stored entries after treating one read error as an empty registry", async () => {
    const registryFile = "/repo/.poe-code/worktrees.yaml";
    const base = createFsFromVolume(Volume.fromJSON({
      [registryFile]: "worktrees:\n  - name: old\n    path: /repo/.poe-code/worktrees/old\n    branch: old\n    baseBranch: main\n    createdAt: 2026-05-25T00:00:00.000Z\n    source: probe\n    agent: codex\n    status: active\n",
    })).promises as unknown as WorktreeFileSystem;
    let firstRead = true;
    const fs: WorktreeFileSystem = {
      ...base,
      async readFile(filePath, encoding) {
        if (filePath === registryFile && firstRead) {
          firstRead = false;
          throw new Error("registry temporarily unreadable");
        }
        return base.readFile(filePath, encoding);
      },
    };

    await addWorktreeEntry(registryFile, {
      name: "new", path: "/repo/.poe-code/worktrees/new", branch: "new", baseBranch: "main",
      createdAt: "2026-05-25T01:00:00.000Z", source: "probe", agent: "codex", status: "active",
    }, fs);
    const registry = await readRegistry(registryFile, base);
    console.log(JSON.stringify(registry));
    expect(registry.worktrees.map(entry => entry.name)).toEqual(["new"]);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/worktree/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"worktrees":[{"name":"new","path":"/repo/.poe-code/worktrees/new","branch":"new","baseBranch":"main","createdAt":"2026-05-25T01:00:00.000Z","source":"probe","agent":"codex","status":"active"}]}
✓ packages/worktree/src/__probe__.test.ts > worktree registry transient read failure > overwrites stored entries after treating one read error as an empty registry
```

Remove the disposable probe after validation.

## Observed Behavior

`readRegistry()` catches all read and parse exceptions and returns `{ worktrees: [] }` at `packages/worktree/src/registry.ts:14` through `packages/worktree/src/registry.ts:20`. `addWorktreeEntry()` trusts that fallback result, pushes the requested new entry, and persists it through `writeRegistry()` at `packages/worktree/src/registry.ts:33` through `packages/worktree/src/registry.ts:40`. In the probe, a temporary read failure hides the valid `old` entry, the add operation resolves successfully, and the persisted registry contains only `new`.

## Expected Behavior

Only an absent registry file should initialize an empty registry. Permission errors, temporary I/O failures, or malformed persisted contents must fail the mutation without overwriting the last stored registry data.

## Impact

A transient filesystem or permission issue during a worktree add, removal, or status update can silently delete tracking metadata for unrelated active worktrees while reporting success. Later list and cleanup operations lose visibility into those directories and branches, leading to leaked worktrees, conflicting re-creation, or removal decisions based on incomplete state.
