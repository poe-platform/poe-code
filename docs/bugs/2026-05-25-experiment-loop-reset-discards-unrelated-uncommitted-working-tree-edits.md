---
name: "Experiment loop reset discards unrelated uncommitted working tree edits"
---

# Experiment loop reset discards unrelated uncommitted working tree edits

## Summary

When an experiment is discarded or produces no journal entry, `@poe-code/experiment-loop` protects only files under `.poe-code/experiments` before issuing `git reset --hard`. Any pre-existing uncommitted user edits elsewhere in the repository are deleted by the reset, even though they are unrelated to the experiment being evaluated.

## Reproduction

Run a disposable Vitest probe from the repository root. The probe creates an isolated Git repository, makes one user edit outside `.poe-code/experiments` and one experiment-document edit inside that directory, then calls the package's reset adapter:

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

describe("experiment reset with unrelated working tree edits", () => {
  it("hard-resets user edits outside the experiment documents directory", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "experiment-loop-edits-"));
    await git(cwd, "init", "-q");
    await git(cwd, "config", "user.email", "probe@example.test");
    await git(cwd, "config", "user.name", "Probe");
    await mkdir(path.join(cwd, ".poe-code", "experiments"), { recursive: true });
    await writeFile(path.join(cwd, "user-work.txt"), "committed\n");
    await writeFile(path.join(cwd, ".poe-code", "experiments", "run.md"), "original\n");
    await git(cwd, "add", ".");
    await git(cwd, "commit", "-qm", "base");
    const base = await git(cwd, "rev-parse", "HEAD");

    await writeFile(path.join(cwd, "user-work.txt"), "uncommitted-user-edit\n");
    await writeFile(path.join(cwd, ".poe-code", "experiments", "run.md"), "experiment-doc-edit\n");

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

    const userWork = await readFile(path.join(cwd, "user-work.txt"), "utf8");
    const experimentDoc = await readFile(path.join(cwd, ".poe-code", "experiments", "run.md"), "utf8");
    console.log(JSON.stringify({ userWork, experimentDoc }));
    expect(userWork).toBe("committed\n");
    expect(experimentDoc).toBe("experiment-doc-edit\n");
  });
});
PROBE
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm packages/experiment-loop/src/__probe__.test.ts
```

Output:

```text
{"userWork":"committed\n","experimentDoc":"experiment-doc-edit\n"}
✓ packages/experiment-loop/src/__probe__.test.ts > experiment reset with unrelated working tree edits > hard-resets user edits outside the experiment documents directory
```

## Observed Behavior

`createDefaultGit().reset()` in `packages/experiment-loop/src/git/git.ts:27` through `packages/experiment-loop/src/git/git.ts:38` stashes only `.poe-code/experiments`, then runs `git reset --hard <preExperimentHash>` for the entire worktree, and restores only the scoped experiment-document stash. The probe begins with an uncommitted edit to `user-work.txt` outside the experiment-documents directory and an edit to `.poe-code/experiments/run.md`. After reset, the experiment document is restored from the scoped stash, but `user-work.txt` has reverted to its committed content, proving that unrelated user work was deleted.

## Expected Behavior

Discarding an experiment should revert changes produced by that experiment without destroying unrelated working-tree edits that already existed or occur outside the experiment's managed files. The reset flow should either require a clean worktree, preserve all unrelated modifications, or isolate experiment changes in a separate checkout.

## Impact

Running an experiment loop in a repository with unsaved local work can silently erase edits outside the experiment document area when a trial is rejected or fails to journal a result. This is direct data loss: users may lose ongoing source-code or documentation changes simply because an unrelated experiment is reset.
