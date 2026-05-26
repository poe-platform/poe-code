# Workspace resolver post-clone filesystem failure leaves unmanaged shared cache

## Summary

`cloneOrUpdate()` runs `git clone` into the shared GitHub cache and then performs an additional filesystem `mkdir(cacheDir)` operation before returning. If that post-clone filesystem call fails, workspace resolution rejects even though Git has already created the requested checkout, and the resolver makes no cleanup or recovery attempt. The failed operation can therefore leave an unmanaged shared cache behind that later resolutions will treat as pre-existing state.

## Reproduction

From the repository root, run a disposable Vitest probe whose missing-cache check and parent creation permit cloning, whose Git clone succeeds, and whose subsequent cache-directory filesystem step rejects:

```sh
cat > packages/workspace-resolver/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { cloneOrUpdate } from "./github/clone.js";
describe("GitHub cache post-clone failure", () => {
  it("rejects after git clone succeeds when bookkeeping mkdir fails", async () => {
    let statCalls = 0;
    const fs = {
      stat: vi.fn(async () => {
        statCalls += 1;
        throw new Error("missing");
      }),
      mkdir: vi.fn(async (target: string) => {
        if (target.endsWith("/owner-repo")) throw new Error("cache mkdir failed");
      }),
    };
    const exec = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const outcome = await cloneOrUpdate(
      { scheme: "github", owner: "owner", repo: "repo" },
      { baseDir: "/repo", homeDir: "/home/test", fs, exec },
    ).then(
      () => ({ resolved: true }),
      (error: Error) => ({ rejected: error.message }),
    );
    console.log(JSON.stringify({ outcome, exec: exec.mock.calls.map((call) => call[1]), statCalls }));
    expect(outcome).toEqual({ rejected: "cache mkdir failed" });
    expect(exec.mock.calls).toHaveLength(1);
    expect(exec.mock.calls[0]?.[1][0]).toBe("clone");
  });
});
EOF
trap 'rm -f packages/workspace-resolver/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/workspace-resolver/src/__probe__.test.ts --reporter verbose
nl -ba packages/workspace-resolver/src/github/clone.ts | sed -n '21,53p'
nl -ba packages/workspace-resolver/src/resolve.ts | sed -n '23,47p'
```

## Observed Behavior

The shared repository clone operation completes successfully, but the resolver rejects immediately afterward and performs no corresponding deletion or Git cleanup:

```text
{"outcome":{"rejected":"cache mkdir failed"},"exec":[["clone","--depth","1","https://github.com/owner/repo.git","/home/test/.poe-code/workspaces/github/owner-repo"]],"statCalls":1}
✓ packages/workspace-resolver/src/__probe__.test.ts > GitHub cache post-clone failure > rejects after git clone succeeds when bookkeeping mkdir fails
```

For a missing cache, `cloneOrUpdate()` creates the parent directory, performs `git clone`, and then invokes `options.fs.mkdir(cacheDir, { recursive: true })` before returning in `packages/workspace-resolver/src/github/clone.ts:21` through `packages/workspace-resolver/src/github/clone.ts:53`. No cleanup surrounds that post-clone failure path, and `resolveWorkspace()` simply propagates the rejection in `packages/workspace-resolver/src/resolve.ts:23` through `packages/workspace-resolver/src/resolve.ts:47`.

## Expected Behavior

If any setup step fails after a new shared clone is created, resolution should remove or clearly preserve-and-validate the new cache before returning an error. A rejected first resolution must not silently leave a partially managed cache to affect later calls.

## Impact

Filesystem adapter errors, permission transitions, or storage failures after cloning can make a failed workspace request leave behind persistent shared repository state. Later resolutions may reuse that cache despite the original failed setup, complicating recovery, consuming disk space, and making cache provenance and failure handling unpredictable.
