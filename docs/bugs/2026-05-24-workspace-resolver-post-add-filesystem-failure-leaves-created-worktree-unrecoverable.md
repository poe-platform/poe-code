# Workspace resolver post-add filesystem failure leaves created worktree unrecoverable

## Summary

`createWritableCheckout()` successfully runs `git worktree add` before it performs a second filesystem `mkdir()` for the returned checkout path. If that post-add filesystem operation fails, the function rejects before returning its cleanup callback and never attempts to remove the already-created Git worktree. The caller receives only the local failure and has no resolver-provided teardown handle for the orphaned checkout.

## Reproduction

From the repository root, run a disposable Vitest probe whose first parent-directory creation succeeds, Git worktree creation succeeds, and the subsequent filesystem creation rejects:

```sh
cat > packages/workspace-resolver/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { createWritableCheckout } from "./github/isolation.js";
describe("writable checkout post-create failure", () => {
  it("rejects after git creates a worktree without attempting cleanup", async () => {
    const exec = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    let mkdirCount = 0;
    const fs = {
      mkdir: vi.fn(async () => {
        mkdirCount += 1;
        if (mkdirCount === 2) throw new Error("local mkdir failed");
      }),
      stat: vi.fn(async () => ({ isDirectory: () => true })),
      rm: vi.fn(async () => undefined),
    };
    const outcome = await createWritableCheckout(
      { scheme: "github", owner: "owner", repo: "repo" }, "/cache",
      { baseDir: "/repo", homeDir: "/home/test", fs, exec },
    ).then(
      () => ({ resolved: true }),
      (error: Error) => ({ rejected: error.message }),
    );
    console.log(JSON.stringify({ outcome, calls: exec.mock.calls.map((call) => call[1]) }));
    expect(outcome).toEqual({ rejected: "local mkdir failed" });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["worktree", "add"]));
    expect(exec.mock.calls.some((call) => call[1][1] === "remove")).toBe(false);
    expect(fs.rm).not.toHaveBeenCalled();
  });
});
EOF
trap 'rm -f packages/workspace-resolver/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/workspace-resolver/src/__probe__.test.ts --reporter verbose
nl -ba packages/workspace-resolver/src/github/isolation.ts | sed -n '4,43p'
```

## Observed Behavior

The worktree-add operation succeeds, the following filesystem step rejects, and no Git removal or fallback deletion is attempted before the exported function rejects:

```text
{"outcome":{"rejected":"local mkdir failed"},"calls":[["worktree","add","--detach","/home/test/.poe-code/workspaces/checkouts/owner-repo/<checkout-id>","HEAD"]]}
✓ packages/workspace-resolver/src/__probe__.test.ts > writable checkout post-create failure > rejects after git creates a worktree without attempting cleanup
```

`createWritableCheckout()` creates the checkout parent, executes `git worktree add`, and then performs another `mkdir(cwd)` before it constructs and returns the cleanup callback in `packages/workspace-resolver/src/github/isolation.ts:4` through `packages/workspace-resolver/src/github/isolation.ts:43`. There is no `try`/`catch` cleanup around operations that can fail after Git has already created the worktree.

## Expected Behavior

Once `git worktree add` succeeds, any later setup failure should trigger best-effort removal of that created worktree before the error is returned. Callers should never receive a rejected workspace resolution that has already materialized an unmanaged writable checkout.

## Impact

Transient filesystem errors, injected filesystem adapters, quota failures, or permissions changes after worktree creation can leak editable checkouts and stale Git worktree registrations without providing a cleanup handle. Repeated failures accumulate disk state and can interfere with later isolated workspace creation while hiding the actual leaked resource from callers.
