# Agent script git revert forged savepoint deletes arbitrary Git ref

## Summary

`@poe-code/agent-script` exposes a `git.revert(savepoint)` host operation to harness scripts. The method accepts any nonempty `stashRef` string supplied by the script and deletes that ref in a `finally` block, without verifying it was created by `git.checkpoint()` or belongs beneath the package's checkpoint namespace. A harness can therefore ask revert to delete arbitrary repository refs such as `refs/heads/main`.

## Reproduction

From the repository root, run this disposable Vitest probe. It stubs Git execution so the restore attempt fails, then confirms that cleanup still issues deletion of a forged branch ref:

```sh
cat > packages/agent-script/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  realpath: vi.fn(async (target: string) => target),
  rm: vi.fn(async () => undefined)
}));

import { execFile } from "node:child_process";
import { makeGitModule } from "./modules/git.js";

type Callback = (error: Error | null, stdout: string, stderr: string) => void;

describe("forged git savepoint cleanup", () => {
  it("deletes a caller-selected branch ref even when restoring it fails", async () => {
    const calls: string[][] = [];
    vi.mocked(execFile).mockImplementation(((file, args, _options, callback) => {
      void file;
      const command = [...(args as string[])];
      calls.push(command);
      if (command[0] === "stash" && command[1] === "apply") {
        (callback as Callback)(new Error("not a stash"), "", "not a stash");
      } else {
        (callback as Callback)(null, "", "");
      }
      return {} as never;
    }) as typeof execFile);

    const git = makeGitModule("/repo");
    await expect(git.revert({ head: "HEAD", stashRef: "refs/heads/main" })).rejects.toThrow(
      "stash apply"
    );

    const deletesMain = calls.some((args) => args.join(" ") === "update-ref --delete refs/heads/main");
    console.log(JSON.stringify({ calls, deletesMain }));
    expect(deletesMain).toBe(true);
  });
});
EOF
trap 'rm -f packages/agent-script/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/agent-script/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The harness-controlled branch ref is passed directly to `git update-ref --delete`, even though applying it as a stash failed:

```text
{"calls":[["reset","--hard","HEAD"],["clean","--force","-d"],["stash","apply","--index","refs/heads/main"],["update-ref","--delete","refs/heads/main"]],"deletesMain":true}
✓ packages/agent-script/src/__probe__.test.ts > forged git savepoint cleanup > deletes a caller-selected branch ref even when restoring it fails
```

The README presents the `git` module, including `checkpoint` and `revert`, as a host capability exposed to scripts in `packages/agent-script/README.md:130`. `checkpoint()` generates owned refs only beneath `refs/poe-code/checkpoints/` in `packages/agent-script/src/modules/git.ts:49` and `packages/agent-script/src/modules/git.ts:237`. In contrast, `normalizeSavepoint()` accepts any nonempty `stashRef` at `packages/agent-script/src/modules/git.ts:198`, and `revert()` unconditionally passes that string to `deleteSavepointRef()` in its cleanup path at `packages/agent-script/src/modules/git.ts:105`. `deleteSavepointRef()` executes `git update-ref --delete <stashRef>` without ownership validation at `packages/agent-script/src/modules/git.ts:402`.

## Expected Behavior

`git.revert()` should accept only savepoint refs produced by the same module and limited to its dedicated `refs/poe-code/checkpoints/` namespace, or it should retain opaque savepoint ownership state that harness code cannot forge. It must never delete arbitrary caller-selected Git refs during cleanup.

## Impact

A harness with access to the documented `git` host module can delete repository branches, tags, or other refs while appearing to perform a normal revert operation. This can destroy locally reachable work, disrupt subsequent Git operations, and convert an intended rollback capability into arbitrary repository-reference mutation.
