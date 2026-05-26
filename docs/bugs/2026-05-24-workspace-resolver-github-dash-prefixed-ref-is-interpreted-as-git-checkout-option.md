# Workspace resolver GitHub dash-prefixed ref is interpreted as git checkout option

## Summary

`@poe-code/workspace-resolver` accepts arbitrary GitHub locator refs and appends them directly as the next argument to `git checkout`. A locator such as `github://owner/repo#--detach` is therefore interpreted by Git as a command option rather than a requested ref: checkout can succeed while detaching the current cached HEAD instead of resolving a branch, tag, or commit identified by the locator.

## Reproduction

First, demonstrate Git’s interpretation of the forwarded argument in a disposable repository:

```sh
probe=$(mktemp -d /tmp/workspace-ref-option-probe.XXXXXX)
git -C "$probe" init -q
git -C "$probe" config user.email probe@example.test
git -C "$probe" config user.name probe
printf 'main\n' > "$probe/content.txt"
git -C "$probe" add content.txt
git -C "$probe" commit -qm initial
git -C "$probe" branch feature
git -C "$probe" checkout -q feature
printf 'feature\n' > "$probe/content.txt"
git -C "$probe" commit -qam feature
git -C "$probe" checkout -q master 2>/dev/null || git -C "$probe" checkout -q main
printf 'before='; git -C "$probe" rev-parse --abbrev-ref HEAD
git -C "$probe" checkout --detach
printf 'after='; git -C "$probe" rev-parse --abbrev-ref HEAD
printf 'content='; cat "$probe/content.txt"
rm -rf "$probe"
```

Representative output:

```text
before=main
HEAD is now at <commit> initial
after=HEAD
content=main
```

Then run a transient Vitest probe showing the resolver emits that command:

```sh
cat > packages/workspace-resolver/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { fs as rawFs, vol } from "memfs";
import { resolveWorkspace } from "./resolve.js";

describe("github ref option arguments", () => {
  it("passes a ref beginning with dashes as a git checkout option", async () => {
    vol.reset();
    const cache = "/home/test/.poe-code/workspaces/github/owner-repo";
    await rawFs.promises.mkdir(cache, { recursive: true });
    const exec = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    await resolveWorkspace("github://owner/repo#--detach", {
      baseDir: "/repo", homeDir: "/home/test", mode: "read", fs: rawFs.promises, exec
    } as never);
    const commands = exec.mock.calls.map((call) => call[1]);
    console.log(JSON.stringify(commands));
    expect(commands).toContainEqual(["checkout", "--detach"]);
  });
});
PROBE
npm exec -- vitest run packages/workspace-resolver/src/__probe__.test.ts --reporter verbose
rm packages/workspace-resolver/src/__probe__.test.ts
```

## Observed Behavior

`parseGithubLocator()` stores the fragment ref without validating dash-prefixed option-like values at `packages/workspace-resolver/src/parse.ts:32` through `packages/workspace-resolver/src/parse.ts:63`. For any truthy ref, `cloneOrUpdate()` emits `git checkout` followed immediately by that untrusted string at `packages/workspace-resolver/src/github/clone.ts:42` through `packages/workspace-resolver/src/github/clone.ts:50`. Since no `--` end-of-options separator is inserted, Git interprets `--detach` as its checkout flag and exits successfully while leaving the cached tree at its pre-existing revision in detached state.

## Expected Behavior

A locator ref should be handled as a Git revision argument, never as a command option. The resolver should reject option-like refs or terminate option parsing before forwarding the requested ref so a successful resolution proves the specified revision was actually selected.

## Impact

Callers can request a GitHub locator that appears to target a particular revision but instead mutates shared cache state through Git options and returns unrelated code successfully. This can detach or otherwise alter cached workspaces and cause agents to analyze or modify source content that does not correspond to the locator they were given.
