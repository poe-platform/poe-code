# Workspace resolver GitHub read ref mutates shared cache for later readers

## Summary

GitHub workspaces in `read` mode are documented as shared read-only checkouts, but resolving a locator with a requested ref runs `git checkout <ref>` inside that shared cache. A later read-mode caller that requests the repository without a ref receives the same cache directory still checked out at the prior caller’s branch or commit, so one read resolution silently changes the source tree observed by other readers.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/workspace-resolver/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { fs as rawFs, vol } from "memfs";
import { resolveWorkspace } from "./resolve.js";

describe("github shared read checkout ref", () => {
  it("changes the shared read cache checkout to a caller-selected ref", async () => {
    vol.reset();
    const cache = "/home/test/.poe-code/workspaces/github/owner-repo";
    await rawFs.promises.mkdir(cache, { recursive: true });
    const exec = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const options = { baseDir: "/repo", homeDir: "/home/test", mode: "read", fs: rawFs.promises, exec } as never;

    const first = await resolveWorkspace("github://owner/repo#feature", options);
    const second = await resolveWorkspace("github://owner/repo", options);
    console.log(JSON.stringify({ first: first.cwd, second: second.cwd, commands: exec.mock.calls.map((call) => call[1]) }));
    expect(first.cwd).toBe(cache);
    expect(second.cwd).toBe(cache);
    expect(exec.mock.calls.map((call) => call[1])).toContainEqual(["checkout", "feature"]);
    expect(exec.mock.calls.map((call) => call[1])).not.toContainEqual(["checkout", "HEAD"]);
  });
});
PROBE
npm exec -- vitest run packages/workspace-resolver/src/__probe__.test.ts --reporter verbose
rm packages/workspace-resolver/src/__probe__.test.ts
```

Output:

```text
{"first":"/home/test/.poe-code/workspaces/github/owner-repo","second":"/home/test/.poe-code/workspaces/github/owner-repo","commands":[["status","--porcelain"],["pull","--ff-only"],["fetch","origin"],["checkout","feature"],["status","--porcelain"],["pull","--ff-only"]]}
✓ packages/workspace-resolver/src/__probe__.test.ts > github shared read checkout ref > changes the shared read cache checkout to a caller-selected ref
```

## Observed Behavior

The README states that `read` mode is a “Shared, read-only checkout” in `packages/workspace-resolver/README.md`. `resolveWorkspace()` always invokes `cloneOrUpdate()` before selecting mode-specific isolation at `packages/workspace-resolver/src/resolve.ts:23` through `packages/workspace-resolver/src/resolve.ts:43`. When a GitHub locator contains `ref`, `cloneOrUpdate()` executes `git fetch origin` followed by `git checkout <ref>` directly inside the shared cache directory at `packages/workspace-resolver/src/github/clone.ts:21` through `packages/workspace-resolver/src/github/clone.ts:53`. When the next caller omits a ref, no checkout restores a default revision, so it resolves the already-mutated shared directory.

## Expected Behavior

Read-mode resolution for a particular Git ref should not change the working tree exposed to other read callers. Ref-specific reads should use immutable/ref-isolated checkouts, or each read should guarantee the requested default/current revision rather than inheriting a previous caller’s checkout state.

## Impact

Concurrent or sequential read-only agent sessions can operate on the wrong repository branch or commit depending on which locator was resolved earlier. Tasks intended for the default branch may inspect or act on feature-branch content, and ref-specific reads can unpredictably interfere with other read-only work despite the API presenting them as shared safe reads.
