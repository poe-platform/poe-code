# Workspace resolver GitHub clean cache silently ignores pull failure

## Summary

When a GitHub workspace cache already exists and is clean, `@poe-code/workspace-resolver` attempts to update it with `git pull --ff-only` before returning it. The pull result is ignored: a failed update still produces a successful resolved workspace pointing at stale cached contents, without surfacing the update failure to the caller.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/workspace-resolver/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { fs as rawFs, vol } from "memfs";
import { resolveWorkspace } from "./resolve.js";

describe("github cached read update failure", () => {
  it("resolves successfully even when git pull fails", async () => {
    vol.reset();
    const cache = "/home/test/.poe-code/workspaces/github/owner-repo";
    await rawFs.promises.mkdir(cache, { recursive: true });
    const exec = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "pull") return { stdout: "", stderr: "network unavailable", exitCode: 1 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const result = await resolveWorkspace("github://owner/repo", {
      baseDir: "/repo", homeDir: "/home/test", mode: "read", fs: rawFs.promises, exec
    } as never);
    console.log(JSON.stringify({ cwd: result.cwd, commands: exec.mock.calls.map((call) => call[1]) }));
    expect(result.cwd).toBe(cache);
    expect(exec.mock.calls.map((call) => call[1])).toContainEqual(["pull", "--ff-only"]);
  });
});
PROBE
npm exec -- vitest run packages/workspace-resolver/src/__probe__.test.ts --reporter verbose
rm packages/workspace-resolver/src/__probe__.test.ts
```

Output:

```text
{"cwd":"/home/test/.poe-code/workspaces/github/owner-repo","commands":[["status","--porcelain"],["pull","--ff-only"]]}
✓ packages/workspace-resolver/src/__probe__.test.ts > github cached read update failure > resolves successfully even when git pull fails
```

## Observed Behavior

For an existing cache, `cloneOrUpdate()` checks `git status --porcelain` and, when the directory is clean, calls `git pull --ff-only` at `packages/workspace-resolver/src/github/clone.ts:35` through `packages/workspace-resolver/src/github/clone.ts:40`. Unlike initial clone, ref fetch, and ref checkout operations in the same function, the pull invocation is not passed through `assertExecSuccess()` at `packages/workspace-resolver/src/github/clone.ts:28` through `packages/workspace-resolver/src/github/clone.ts:50` and `packages/workspace-resolver/src/github/clone.ts:68` through `packages/workspace-resolver/src/github/clone.ts:77`. `resolveWorkspace()` consequently returns the stale directory as a successful workspace at `packages/workspace-resolver/src/resolve.ts:23` through `packages/workspace-resolver/src/resolve.ts:43`.

## Expected Behavior

If the resolver attempts to update a clean cached GitHub checkout and that update fails, resolution should reject with the git error or explicitly expose stale/offline fallback semantics. It should not silently claim successful current workspace resolution after dropping an update failure.

## Impact

Agents and automation can operate on outdated repository content after network, authentication, or fast-forward update failures without any indication that the cache is stale. This can produce incorrect analysis, edits, or test results against code different from the requested current repository state while upstream failures remain hidden.
