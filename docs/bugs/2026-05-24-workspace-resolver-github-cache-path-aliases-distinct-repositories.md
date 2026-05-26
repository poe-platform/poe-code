# Workspace resolver GitHub cache path aliases distinct repositories

## Summary

`@poe-code/workspace-resolver` constructs the GitHub clone cache directory by concatenating `owner` and `repo` with a single hyphen. Distinct locators whose owner/repository boundaries differ but concatenate to the same text, such as `github://a-b/c` and `github://a/b-c`, resolve to the same cached checkout. After the first clone, resolving the second repository silently runs update operations in and returns the first repository's directory.

## Reproduction

From the repository root, run a disposable Vitest probe that resolves two different GitHub locators with a shared in-memory filesystem and records Git operations:

```sh
cat > packages/workspace-resolver/src/__probe__.test.ts <<'EOF'
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { resolveWorkspace } from "./resolve.js";
import type { ResolverFileSystem } from "./types.js";
describe("github workspace cache identity", () => {
  it("reuses the same cache path for distinct owner/repository pairs", async () => {
    const fs = createFsFromVolume(new Volume()).promises as unknown as ResolverFileSystem;
    const commands: string[][] = [];
    const options = {
      baseDir: "/repo",
      homeDir: "/home/test",
      fs,
      exec: async (_command: string, args: string[]) => {
        commands.push(args);
        if (args[0] === "clone") await fs.mkdir(args[4], { recursive: true });
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    const first = await resolveWorkspace("github://a-b/c", options);
    const second = await resolveWorkspace("github://a/b-c", options);
    console.log(JSON.stringify({ first, second, commands }));
    expect(first.cwd).toBe("/home/test/.poe-code/workspaces/github/a-b-c");
    expect(second.cwd).toBe(first.cwd);
    expect(commands.filter((args) => args[0] === "clone")).toHaveLength(1);
    expect(commands.some((args) => args[0] === "pull")).toBe(true);
  });
});
EOF
trap 'rm -f packages/workspace-resolver/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/workspace-resolver/src/__probe__.test.ts --reporter verbose
nl -ba packages/workspace-resolver/src/github/clone.ts | sed -n '1,72p'
nl -ba packages/workspace-resolver/src/resolve.ts | sed -n '23,43p'
nl -ba packages/workspace-resolver/README.md | sed -n '42,54p'
```

## Observed Behavior

Only the first repository is cloned. The second distinct locator receives the same `cwd`, and the resolver performs `git status` and `git pull` against the already-cached first repository instead of cloning `github://a/b-c`:

```text
{"first":{"cwd":"/home/test/.poe-code/workspaces/github/a-b-c","locator":{"scheme":"github","owner":"a-b","repo":"c"}},"second":{"cwd":"/home/test/.poe-code/workspaces/github/a-b-c","locator":{"scheme":"github","owner":"a","repo":"b-c"}},"commands":[["clone","--depth","1","https://github.com/a-b/c.git","/home/test/.poe-code/workspaces/github/a-b-c"],["status","--porcelain"],["pull","--ff-only"]]}
✓ packages/workspace-resolver/src/__probe__.test.ts > github workspace cache identity > reuses the same cache path for distinct owner/repository pairs
```

The cache key is `${locator.owner}-${locator.repo}` in `packages/workspace-resolver/src/github/clone.ts:4` through `packages/workspace-resolver/src/github/clone.ts:14`, while `cloneOrUpdate()` treats any existing directory at that path as the requested repository in `packages/workspace-resolver/src/github/clone.ts:20` through `packages/workspace-resolver/src/github/clone.ts:55`. `resolveWorkspace()` then returns that directory for the original locator in `packages/workspace-resolver/src/resolve.ts:23` through `packages/workspace-resolver/src/resolve.ts:43`, despite the README describing the cache as belonging to `owner-repo` in `packages/workspace-resolver/README.md:42` through `packages/workspace-resolver/README.md:54`.

## Expected Behavior

Every distinct GitHub owner/repository pair should map to a distinct cache identity, or an existing cache directory should be verified against the requested remote before it is reused. Resolving one repository must never silently return another repository's checkout.

## Impact

Agents targeting a repository whose name aliases an already-cached locator can read, build, or edit an entirely different codebase while being told they are operating on the requested repository. In writable modes this can also create worktrees from the wrong source, causing incorrect changes, accidental disclosure of unrelated code, and misleading automation results.
