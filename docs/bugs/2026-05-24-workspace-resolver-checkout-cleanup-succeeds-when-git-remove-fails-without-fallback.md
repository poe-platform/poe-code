# Workspace resolver checkout cleanup succeeds when git remove fails without fallback

## Summary

The cleanup callback returned by `createWritableCheckout()` swallows a failing `git worktree remove --force` result. It attempts an optional filesystem `rm` fallback only when the injected filesystem exposes that method; if `rm` is absent, cleanup simply resolves successfully after Git reports failure, leaving the editable worktree registered and potentially present on disk without notifying the caller.

## Reproduction

From the repository root, run a disposable Vitest probe whose resolver filesystem satisfies the public interface without optional `rm`, while Git worktree removal fails:

```sh
cat > packages/workspace-resolver/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { createWritableCheckout } from "./github/isolation.js";
describe("writable checkout cleanup failures", () => {
  it("resolves cleanup after worktree removal fails when no rm fallback exists", async () => {
    const calls: string[][] = [];
    const checkout = await createWritableCheckout(
      { scheme: "github", owner: "owner", repo: "repo" },
      "/cache",
      {
        baseDir: "/repo",
        homeDir: "/home/test",
        fs: {
          mkdir: vi.fn(async () => undefined),
          stat: vi.fn(async () => ({ isDirectory: () => true })),
        },
        exec: vi.fn(async (_command, args) => {
          calls.push(args);
          return args[1] === "remove"
            ? { stdout: "", stderr: "still in use", exitCode: 1 }
            : { stdout: "", stderr: "", exitCode: 0 };
        }),
      },
    );
    const outcome = await checkout.cleanup().then(
      () => ({ resolved: true }),
      (error: Error) => ({ resolved: false, error: error.message }),
    );
    console.log(JSON.stringify({ outcome, calls }));
    expect(outcome).toEqual({ resolved: true });
    expect(calls.at(-1)).toEqual(["worktree", "remove", "--force", checkout.cwd]);
  });
});
EOF
trap 'rm -f packages/workspace-resolver/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/workspace-resolver/src/__probe__.test.ts --reporter verbose
nl -ba packages/workspace-resolver/src/types.ts | sed -n '9,35p'
nl -ba packages/workspace-resolver/src/github/isolation.ts | sed -n '28,43p'
```

## Observed Behavior

Git reports that worktree removal failed, but the public cleanup callback still resolves successfully because no optional `rm` implementation was provided:

```text
{"outcome":{"resolved":true},"calls":[["worktree","add","--detach","/home/test/.poe-code/workspaces/checkouts/owner-repo/<checkout-id>","HEAD"],["worktree","remove","--force","/home/test/.poe-code/workspaces/checkouts/owner-repo/<checkout-id>"]]}
✓ packages/workspace-resolver/src/__probe__.test.ts > writable checkout cleanup failures > resolves cleanup after worktree removal fails when no rm fallback exists
```

The public `ResolverFileSystem` makes `rm` optional in `packages/workspace-resolver/src/types.ts:9` through `packages/workspace-resolver/src/types.ts:35`. The cleanup callback checks the failed Git result, runs fallback deletion only under `if (options.fs.rm)`, and otherwise reaches successful completion without throwing in `packages/workspace-resolver/src/github/isolation.ts:28` through `packages/workspace-resolver/src/github/isolation.ts:43`.

## Expected Behavior

Cleanup should reject when Git cannot remove a worktree and no fallback removal operation is available, or the resolver contract should require a reliable fallback. A caller must not receive a successful teardown result while the isolated checkout remains unremoved.

## Impact

Embedders using the documented optional filesystem surface can accumulate orphaned editable checkouts and stale Git worktree registrations after removal failures while believing teardown succeeded. Subsequent worktree creation, disk cleanup, and isolation guarantees become unreliable, and the original cleanup failure is lost.
