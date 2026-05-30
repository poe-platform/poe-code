---
name: "Worktree Status Update Null Registry Entry Throws Native Property Error"
---

# Worktree Status Update Null Registry Entry Throws Native Property Error

## Summary

The exported `updateWorktreeStatus()` API accepts a registry whose `worktrees` field is a syntactically valid YAML array, but assumes every array item is a worktree object. If that array includes `null`, status lookup fails with a native property-access exception instead of reporting malformed registry state.

## Reproduction

Create the disposable probe `packages/worktree/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { updateWorktreeStatus } from "./registry.js";
import type { WorktreeFileSystem } from "./types.js";

describe("updateWorktreeStatus null registry entry", () => {
  it("throws a native property-read error for a valid YAML null list entry", async () => {
    const fs: WorktreeFileSystem = {
      async readFile() { return "worktrees:\n  - null\n"; },
      async mkdir() {},
      async writeFile() { throw new Error("must not write"); }
    };

    await expect(updateWorktreeStatus("/repo/worktrees.yaml", "feature", "done", { fs }))
      .rejects.toThrowError(/name|null|undefined/i);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/worktree/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that a null item inside an otherwise array-shaped registry leaks a native runtime exception. Remove the disposable probe after running it.

## Observed Behavior

For registry content `worktrees:\n  - null\n`, `readRegistry()` returns the parsed object because the `worktrees` array is truthy at `packages/worktree/src/registry.ts:10` through `packages/worktree/src/registry.ts:20`. `updateWorktreeStatus()` then evaluates `registry.worktrees.find((w) => w.name === name)` at `packages/worktree/src/registry.ts:53` through `packages/worktree/src/registry.ts:66`; accessing `name` on the null entry throws a native property-read error before any controlled missing-worktree diagnostic can be returned.

## Expected Behavior

Registry parsing should validate each `worktrees` array item before public mutation operations consume it, and reject malformed entries with an actionable registry-corruption error. A valid YAML array containing an invalid item should not cause incidental property-access exceptions.

## Impact

A partially edited, corrupted, or manually repaired registry can contain a null placeholder while still parsing as YAML. Status transition commands then crash before identifying the malformed record or requested worktree, preventing recovery operations and obscuring which persisted registry entry needs repair.
