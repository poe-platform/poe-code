# Experiment loop reset pops unrelated existing user stash

## Summary

`@poe-code/experiment-loop` restores experiment-document changes after a discard/reset by running `git stash pop` whenever its scoped `git stash push` command exits successfully. Real Git exits successfully even when there are no matching `.poe-code/experiments` changes to stash, so a pre-existing user stash is popped into the working tree and removed from the stash list during an experiment reset.

## Reproduction

Run a disposable Vitest probe from the repository root. The probe creates an isolated Git repository with an existing user stash, makes no changes under `.poe-code/experiments`, and invokes the package's Git reset adapter:

```sh
cat > packages/experiment-loop/src/__probe__.test.ts <<'PROBE'
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createDefaultGit } from "./git/git.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

describe("experiment reset with existing stash", () => {
  it("pops a pre-existing user stash when experiment docs have no changes", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "experiment-loop-stash-"));
    await git(cwd, "init", "-q");
    await git(cwd, "config", "user.email", "probe@example.test");
    await git(cwd, "config", "user.name", "Probe");
    await mkdir(path.join(cwd, ".poe-code", "experiments"), { recursive: true });
    await writeFile(path.join(cwd, "tracked.txt"), "base\n");
    await writeFile(path.join(cwd, ".poe-code", "experiments", "run.md"), "plan\n");
    await git(cwd, "add", ".");
    await git(cwd, "commit", "-qm", "base");
    const base = await git(cwd, "rev-parse", "HEAD");

    await writeFile(path.join(cwd, "tracked.txt"), "user-stashed-change\n");
    await git(cwd, "stash", "push", "-qm", "user work");

    const adapter = createDefaultGit(async (command, options) => {
      try {
        const { stdout, stderr } = await execFileAsync("sh", ["-c", command], { cwd: options?.cwd });
        return { stdout, stderr, exitCode: 0 };
      } catch (error) {
        const failure = error as Error & { stdout?: string; stderr?: string; code?: number };
        return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? failure.message, exitCode: failure.code ?? 1 };
      }
    });

    await adapter.reset(base, cwd);

    const restoredContent = await readFile(path.join(cwd, "tracked.txt"), "utf8");
    const stashList = await git(cwd, "stash", "list");
    console.log(JSON.stringify({ restoredContent, stashList }));
    expect(restoredContent).toBe("user-stashed-change\n");
    expect(stashList).toBe("");
  });
});
PROBE
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm packages/experiment-loop/src/__probe__.test.ts
```

Output:

```text
{"restoredContent":"user-stashed-change\n","stashList":""}
✓ packages/experiment-loop/src/__probe__.test.ts > experiment reset with existing stash > pops a pre-existing user stash when experiment docs have no changes
```

## Observed Behavior

`createDefaultGit().reset()` in `packages/experiment-loop/src/git/git.ts:22` through `packages/experiment-loop/src/git/git.ts:36` runs `git stash push -q --include-untracked -- .poe-code/experiments`, assigns `stashed = stashResult.exitCode === 0`, hard-resets the repository, and then runs an unqualified `git stash pop -q` whenever `stashed` is true. In a real repository with no changed files under the scoped experiment-documents path, that stash command still returns exit code `0` without creating a new stash entry. The subsequent pop therefore consumes the already-existing user's stash instead. The probe confirms that unrelated stashed content appears in `tracked.txt` and the user's stash list becomes empty.

## Expected Behavior

Experiment reset should restore only the scoped experiment-document changes it stashed itself. If there are no such changes, it should not pop any stash; if it creates a stash, it should restore that specific created stash rather than whichever entry is currently at `stash@{0}`.

## Impact

Discarding or resetting an experiment can silently apply unrelated user work that was intentionally stashed before the experiment began and remove it from stash history. This contaminates the post-reset working tree, can make later experiment evaluation run against unintended changes, and risks data loss or confusion when the user expects their saved work to remain safely stashed.
