# Workspace resolver GitHub subdirectory accepts regular file as workspace root

## Summary

`resolveWorkspace()` validates a requested GitHub `subdir` only by calling `fs.stat()` and ignoring the returned file type. A locator targeting an existing regular file inside the cloned repository, such as `github://owner/repo/README.md`, is therefore returned as a successful workspace `cwd` even though the API and README describe subdirectories and agent working directories.

## Reproduction

From the repository root, run a disposable Vitest probe with a cached repository containing a regular file at the requested subdirectory path:

```sh
cat > packages/workspace-resolver/src/__probe__.test.ts <<'EOF'
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { resolveWorkspace } from "./resolve.js";
import type { ResolverFileSystem } from "./types.js";
describe("github workspace subdirectory validation", () => {
  it("accepts a regular file as the resolved workspace cwd", async () => {
    const rawFs = createFsFromVolume(new Volume()).promises;
    const fs = rawFs as unknown as ResolverFileSystem;
    const cacheDir = "/home/test/.poe-code/workspaces/github/owner-repo";
    await rawFs.mkdir(cacheDir, { recursive: true });
    await rawFs.writeFile(`${cacheDir}/README.md`, "not a directory");
    const result = await resolveWorkspace("github://owner/repo/README.md", {
      baseDir: "/repo",
      homeDir: "/home/test",
      fs,
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    });
    const isDirectory = (await rawFs.stat(result.cwd)).isDirectory();
    console.log(JSON.stringify({ cwd: result.cwd, isDirectory }));
    expect(result.cwd).toBe(`${cacheDir}/README.md`);
    expect(isDirectory).toBe(false);
  });
});
EOF
trap 'rm -f packages/workspace-resolver/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/workspace-resolver/src/__probe__.test.ts --reporter verbose
nl -ba packages/workspace-resolver/src/resolve.ts | sed -n '23,64p'
nl -ba packages/workspace-resolver/README.md | sed -n '27,45p'
```

## Observed Behavior

Resolution succeeds and returns a path that `stat()` confirms is not a directory:

```text
{"cwd":"/home/test/.poe-code/workspaces/github/owner-repo/README.md","isDirectory":false}
✓ packages/workspace-resolver/src/__probe__.test.ts > github workspace subdirectory validation > accepts a regular file as the resolved workspace cwd
```

`resolveWorkspace()` builds the requested working path and calls `assertPathExists()` in `packages/workspace-resolver/src/resolve.ts:23` through `packages/workspace-resolver/src/resolve.ts:47`; that helper calls `fs.stat(target)` but never checks `isDirectory()` in `packages/workspace-resolver/src/resolve.ts:50` through `packages/workspace-resolver/src/resolve.ts:64`. The README defines the GitHub suffix as a `Subdir` within the repository and describes the result as a workspace checkout in `packages/workspace-resolver/README.md:27` through `packages/workspace-resolver/README.md:45`.

## Expected Behavior

Resolving a workspace subdirectory should require the target to be a directory. Existing regular files, sockets, or other non-directory entries should be rejected with a deterministic invalid-workspace error before a `cwd` is returned to a runner.

## Impact

Malformed or user-supplied GitHub locators can pass resolver validation yet fail later at process launch, file discovery, or agent initialization because their `cwd` is a file. The error is deferred away from the source of invalid input, producing misleading workflow failures and preventing reliable upfront workspace validation.
