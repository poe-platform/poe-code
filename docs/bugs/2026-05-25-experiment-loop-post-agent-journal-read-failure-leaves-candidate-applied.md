---
name: "Experiment loop post-agent journal read failure leaves candidate applied"
---

# Experiment loop post-agent journal read failure leaves candidate applied

## Summary

`@poe-code/experiment-loop` relies on a journal re-read after an agent returns to decide whether candidate changes should be kept or rolled back. If that journal inspection fails after the agent has changed files, the exported run rejects before reaching its no-entry reset path, leaving unjournaled candidate edits applied in the workspace.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("post-agent journal read failure", () => {
  it("restores candidate edits when journal inspection fails after the agent returns", async () => {
    const docPath = "/repo/.poe-code/experiments/read-fail.md";
    const journalPath = docPath.replace(/\.md$/, ".journal.jsonl");
    const candidatePath = "/repo/src/candidate.txt";
    const baseFs = createFsFromVolume(Volume.fromJSON({
      [docPath]: ["---", "agent: claude-code", "metric: []", "---", "Improve"].join("\n"),
      [candidatePath]: "original\n"
    }, "/")).promises as unknown as ExperimentFileSystem;
    let failJournalRead = false;
    const fs: ExperimentFileSystem = {
      ...baseFs,
      async readFile(path: string, encoding: BufferEncoding) {
        if (path === journalPath && failJournalRead) {
          throw new Error("journal temporarily unreadable");
        }
        return baseFs.readFile(path, encoding);
      }
    };
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => baseFs.writeFile(candidatePath, "original\n"))
    };
    const runAgent = vi.fn(async (_input: AgentRunInput) => {
      await baseFs.writeFile(candidatePath, "candidate edit\n");
      failJournalRead = true;
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      runAgent
    })).rejects.toThrow("journal temporarily unreadable");

    const candidate = await baseFs.readFile(candidatePath, "utf8");
    console.log(JSON.stringify({ candidate, resets: vi.mocked(git.reset).mock.calls }));
    expect(candidate).toBe("original\n");
    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The journal read error propagates after the candidate edit, and no rollback is attempted:

```text
{"candidate":"candidate edit\n","resets":[]}
AssertionError: expected 'candidate edit\n' to be 'original\n'
```

## Observed Behavior

After `runAgent()` returns, `runExperimentLoop()` in `packages/experiment-loop/src/run/loop.ts` immediately calls `journal.readAll()` to determine the iteration result. The fallback branch that resets a candidate when the agent wrote no new journal entry is reached only after that read succeeds and yields `newEntry === null`. In the reproduction, the agent successfully modifies the candidate file without journaling, then the injected journal read throws. The read exception escapes directly, and `git.reset(preExperimentHash, cwd)` is never called.

## Expected Behavior

Failure to inspect the journal after an agent may have modified the worktree must not strand candidate edits. The loop should attempt to restore the pre-experiment baseline before rejecting, or durably mark the attempt as requiring recovery rather than leaving an unclassified candidate applied.

## Impact

Transient filesystem read failures, permissions changes, or storage faults affecting the experiment journal can turn an otherwise discardable/unrecorded iteration into unexplained applied source changes. Automation receives a failed run while the repository remains modified by work that was never recorded, measured, or accepted, compromising safe retries and experiment auditability.
