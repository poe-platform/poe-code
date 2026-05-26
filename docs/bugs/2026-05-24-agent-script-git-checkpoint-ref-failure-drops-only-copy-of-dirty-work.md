# Agent script git checkpoint ref failure drops only copy of dirty work

## Summary

`@poe-code/agent-script` exposes `git.checkpoint()` so experiment harnesses can preserve dirty repository state before making an attempt. If the method successfully stashes local changes but then fails while creating its dedicated savepoint ref, its error cleanup drops `stash@{0}` without first restoring it. The user's dirty working state is removed from the worktree and its only stash copy is deleted while the operation rejects.

## Reproduction

From the repository root, run this disposable Vitest probe. It simulates a dirty repository where `git stash push` succeeds, but `git update-ref` cannot create the durable checkpoint ref:

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

describe("checkpoint internal failure handling", () => {
  it("drops the only saved dirty-work stash when creating its ref fails", async () => {
    const calls: string[][] = [];
    vi.mocked(execFile).mockImplementation(((file, args, _options, callback) => {
      void file;
      const command = [...(args as string[])];
      calls.push(command);
      if (command[0] === "rev-parse" && command[1] === "HEAD") {
        (callback as Callback)(null, "head\n", "");
      } else if (command[0] === "status") {
        (callback as Callback)(null, " M work.ts\n", "");
      } else if (command[0] === "rev-parse" && command[1] === "stash@{0}") {
        (callback as Callback)(null, "stash-oid\n", "");
      } else if (command[0] === "update-ref" && command[1] !== "--delete") {
        (callback as Callback)(new Error("write failed"), "", "cannot write ref");
      } else {
        (callback as Callback)(null, "", "");
      }
      return {} as never;
    }) as typeof execFile);

    const git = makeGitModule("/repo");
    await expect(git.checkpoint()).rejects.toThrow("update-ref");

    const applied = calls.some((args) => args[0] === "stash" && args[1] === "apply");
    const dropped = calls.some((args) => args.join(" ") === "stash drop stash@{0}");
    console.log(JSON.stringify({ calls, applied, dropped }));
    expect({ applied, dropped }).toEqual({ applied: false, dropped: true });
  });
});
EOF
trap 'rm -f packages/agent-script/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/agent-script/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

After the savepoint ref write fails, cleanup deletes the created stash without any `stash apply` restoring the dirty files:

```text
{"calls":[["rev-parse","HEAD"],["status","--porcelain"],["stash","push","--include-untracked","--message","poe-code checkpoint refs/poe-code/checkpoints/<id>"],["rev-parse","stash@{0}"],["update-ref","refs/poe-code/checkpoints/<id>","stash-oid"],["update-ref","--delete","refs/poe-code/checkpoints/<id>"],["stash","drop","stash@{0}"]],"applied":false,"dropped":true}
✓ packages/agent-script/src/__probe__.test.ts > checkpoint internal failure handling > drops the only saved dirty-work stash when creating its ref fails
```

`checkpoint()` stashes dirty state with `--include-untracked` at `packages/agent-script/src/modules/git.ts:49`, then attempts to create a durable ref and reapply the saved work. Its `catch` invokes `cleanupSavepoint()` for any failure in that sequence at `packages/agent-script/src/modules/git.ts:72`. `cleanupSavepoint()` deletes the checkpoint ref and blindly runs `git stash drop stash@{0}` at `packages/agent-script/src/modules/git.ts:398`, even when the failure occurred before the stash was reapplied to the worktree.

## Expected Behavior

If checkpoint setup fails after stashing local changes, the module must restore the user's stashed work before deleting temporary storage, or preserve the stash and clearly report how to recover it. A rejected checkpoint call must not silently discard dirty tracked or untracked files.

## Impact

A transient Git ref-write failure, permission problem, repository lock, or ref namespace conflict during a normal experiment checkpoint can permanently discard uncommitted user work. Because the API rejects, callers may assume no state was changed, while their modified and newly created files have already been removed and the recovery stash deleted.
