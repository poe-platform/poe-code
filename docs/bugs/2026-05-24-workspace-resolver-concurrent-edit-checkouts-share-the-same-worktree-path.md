# Workspace resolver concurrent edit checkouts share the same worktree path

## Summary

`createWritableCheckout()` identifies editable GitHub worktrees using only `Date.now()` and `process.pid`. Two editable workspace resolutions for the same repository created by the same process within one millisecond generate the identical checkout directory and both issue `git worktree add` against that path, violating the promised isolated writable checkout behavior.

## Reproduction

From the repository root, run a disposable Vitest probe that freezes the clock and concurrently requests two writable checkouts for the same GitHub locator:

```sh
cat > packages/workspace-resolver/src/__probe__.test.ts <<'EOF'
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { createWritableCheckout } from "./github/isolation.js";
import type { ResolverFileSystem } from "./types.js";
describe("writable GitHub checkout identity", () => {
  it("produces the same path for concurrent checkouts in one millisecond", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1234567890);
    const fs = createFsFromVolume(new Volume()).promises as unknown as ResolverFileSystem;
    const adds: string[] = [];
    const options = {
      baseDir: "/repo", homeDir: "/home/test", fs,
      exec: async (_command: string, args: string[]) => {
        if (args[0] === "worktree" && args[1] === "add") adds.push(args[3]);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    const locator = { scheme: "github" as const, owner: "owner", repo: "repo", ref: "main" };
    const [first, second] = await Promise.all([
      createWritableCheckout(locator, "/cache", options),
      createWritableCheckout(locator, "/cache", options),
    ]);
    console.log(JSON.stringify({ first: first.cwd, second: second.cwd, adds }));
    expect(first.cwd).toBe(second.cwd);
    expect(adds[0]).toBe(adds[1]);
  });
});
EOF
trap 'rm -f packages/workspace-resolver/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/workspace-resolver/src/__probe__.test.ts --reporter verbose
nl -ba packages/workspace-resolver/src/github/isolation.ts | sed -n '1,60p'
nl -ba packages/workspace-resolver/README.md | sed -n '108,122p'
```

## Observed Behavior

Both independent editable checkout requests compute and attempt to use exactly the same worktree directory:

```text
{"first":"/home/test/.poe-code/workspaces/checkouts/owner-repo/kf12oi-21qt","second":"/home/test/.poe-code/workspaces/checkouts/owner-repo/kf12oi-21qt","adds":["/home/test/.poe-code/workspaces/checkouts/owner-repo/kf12oi-21qt","/home/test/.poe-code/workspaces/checkouts/owner-repo/kf12oi-21qt"]}
✓ packages/workspace-resolver/src/__probe__.test.ts > writable GitHub checkout identity > produces the same path for concurrent checkouts in one millisecond
```

`createWritableCheckout()` builds every edit checkout below the per-repository checkout parent and obtains the terminal identifier from `createCheckoutId()` in `packages/workspace-resolver/src/github/isolation.ts:4` through `packages/workspace-resolver/src/github/isolation.ts:43`. That identifier is only ``${Date.now().toString(36)}-${process.pid.toString(36)}`` in `packages/workspace-resolver/src/github/isolation.ts:45` through `packages/workspace-resolver/src/github/isolation.ts:47`. The README promises that `edit` mode creates an isolated writable checkout in `packages/workspace-resolver/README.md:108` through `packages/workspace-resolver/README.md:122`.

## Expected Behavior

Each writable workspace resolution should receive a collision-resistant checkout path even when multiple agents resolve the same repository concurrently from one process in the same millisecond. Isolation must not depend on scheduling granularity.

## Impact

Concurrent edit-mode agents can race while creating one shared destination: one checkout may fail unexpectedly, or both callers may be handed overlapping worktree state and cleanup responsibilities. This breaks edit isolation, risks agents reading or changing each other's files, and can make one cleanup remove another active workspace.
