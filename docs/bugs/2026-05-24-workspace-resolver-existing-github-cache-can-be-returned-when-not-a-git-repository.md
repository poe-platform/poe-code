# Workspace resolver existing GitHub cache can be returned when not a Git repository

## Summary

When the expected GitHub cache directory already exists, `cloneOrUpdate()` runs `git status --porcelain` but treats a nonzero status result as a reason to skip pulling rather than as an invalid cache. A pre-existing ordinary directory or corrupted checkout at the computed cache path is consequently returned as a successful `github://owner/repo` workspace without ever cloning or verifying the requested repository.

## Reproduction

From the repository root, run a disposable Vitest probe that precreates the expected cache directory as a non-repository and makes `git status` report the corresponding failure:

```sh
cat > packages/workspace-resolver/src/__probe__.test.ts <<'EOF'
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { resolveWorkspace } from "./resolve.js";
import type { ResolverFileSystem } from "./types.js";
describe("github existing cache validation", () => {
  it("returns a cache directory even when git status says it is not a repository", async () => {
    const rawFs = createFsFromVolume(new Volume()).promises;
    const fs = rawFs as unknown as ResolverFileSystem;
    const cacheDir = "/home/test/.poe-code/workspaces/github/owner-repo";
    await rawFs.mkdir(cacheDir, { recursive: true });
    await rawFs.writeFile(`${cacheDir}/attacker.txt`, "not a checkout");
    const commands: string[][] = [];
    const result = await resolveWorkspace("github://owner/repo", {
      baseDir: "/repo", homeDir: "/home/test", fs,
      exec: async (_command, args) => {
        commands.push(args);
        return args[0] === "status"
          ? { stdout: "", stderr: "fatal: not a git repository", exitCode: 128 }
          : { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    console.log(JSON.stringify({ cwd: result.cwd, commands }));
    expect(result.cwd).toBe(cacheDir);
    expect(commands).toEqual([["status", "--porcelain"]]);
  });
});
EOF
trap 'rm -f packages/workspace-resolver/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/workspace-resolver/src/__probe__.test.ts --reporter verbose
nl -ba packages/workspace-resolver/src/github/clone.ts | sed -n '21,53p'
nl -ba packages/workspace-resolver/src/resolve.ts | sed -n '23,43p'
```

## Observed Behavior

The resolver returns the pre-existing ordinary directory as the resolved GitHub workspace and makes no clone or repair attempt after Git identifies it as not being a repository:

```text
{"cwd":"/home/test/.poe-code/workspaces/github/owner-repo","commands":[["status","--porcelain"]]}
✓ packages/workspace-resolver/src/__probe__.test.ts > github existing cache validation > returns a cache directory even when git status says it is not a repository
```

For any existing cache directory, `cloneOrUpdate()` runs `git status --porcelain` and only uses its result to conditionally call `git pull` when status succeeds and is clean in `packages/workspace-resolver/src/github/clone.ts:21` through `packages/workspace-resolver/src/github/clone.ts:53`. A failed status is not passed through `assertExecSuccess()` and the same directory is returned to `resolveWorkspace()`, which presents it as the requested GitHub workspace in `packages/workspace-resolver/src/resolve.ts:23` through `packages/workspace-resolver/src/resolve.ts:43`.

## Expected Behavior

An existing GitHub cache path should be verified as a valid checkout of the requested repository before reuse. If `git status` fails because the path is not a working tree or is otherwise invalid, resolution should fail or recreate the cache rather than returning arbitrary existing contents.

## Impact

A stale, corrupted, or deliberately pre-created cache directory can make an agent operate on arbitrary local files while the resolver reports a GitHub repository locator. Read operations may expose unrelated contents, and edit-mode worktrees may fail or be created from incorrect state, undermining workspace provenance and isolation guarantees.
