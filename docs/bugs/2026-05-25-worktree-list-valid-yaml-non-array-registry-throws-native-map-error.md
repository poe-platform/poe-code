---
name: "Worktree List Valid YAML Non-Array Registry Throws Native Map Error"
---

# Worktree List Valid YAML Non-Array Registry Throws Native Map Error

## Summary

The exported `listWorktrees()` API trusts any truthy `worktrees` value parsed from the registry YAML as though it were an array. A syntactically valid registry containing `worktrees: true` is returned as a registry object, then listing fails with the native runtime error `registry.worktrees.map is not a function`.

## Reproduction

Create the disposable probe `packages/worktree/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { listWorktrees } from "./list.js";
import type { WorktreeFileSystem } from "./types.js";

describe("worktree valid YAML structural corruption", () => {
  it("throws a native map error when worktrees is a boolean", async () => {
    const fs: WorktreeFileSystem = {
      readFile: vi.fn().mockResolvedValue("worktrees: true\n"),
      writeFile: vi.fn(),
      mkdir: vi.fn()
    };
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    await expect(listWorktrees("/repo", "/repo/worktrees.yaml", { fs, exec }))
      .rejects.toThrowError(/map/);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/worktree/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that a valid YAML document with the wrong `worktrees` shape reaches a native `map` failure. Remove the disposable probe after running it.

## Observed Behavior

Given `worktrees: true`, `readRegistry()` returns the parsed object because it only checks the truthiness of `parsed?.worktrees` at `packages/worktree/src/registry.ts:10` through `packages/worktree/src/registry.ts:20`. `listWorktrees()` then calls `registry.worktrees.map(...)` at `packages/worktree/src/list.ts:9` through `packages/worktree/src/list.ts:20`, causing `TypeError: registry.worktrees.map is not a function` after the otherwise normal Git worktree-list query.

## Expected Behavior

Registry loading should validate that `worktrees` is an array of valid worktree entries or surface a controlled registry-corruption error. A syntactically valid but structurally invalid YAML document should not propagate to public APIs as a falsely typed registry and throw incidental array-method failures.

## Impact

A hand-edited, corrupted, or partially regenerated worktree registry can break worktree listing with an opaque runtime error even though the YAML parses successfully. Higher-level commands cannot display tracked worktrees or offer actionable recovery guidance until users manually identify the malformed field.
