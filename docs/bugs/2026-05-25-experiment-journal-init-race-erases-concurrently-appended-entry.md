# Experiment journal initialization race erases concurrently appended entry

## Summary

The `ExperimentJournal.init()` operation checks whether its JSONL sidecar exists by reading it, then creates an empty journal with a normal write when the read reports `ENOENT`. If another execution creates or appends a valid journal entry between that missing-file observation and the write, initialization overwrites the new history with an empty document.

## Reproduction

From the repository root, add a disposable probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ExperimentJournal } from "./journal/journal.js";
import type { ExperimentFileSystem, JournalEntry } from "./types.js";

describe("experiment journal initialization race repro", () => {
  it("overwrites an entry appended after its missing-file read", async () => {
    const journalPath = "/repo/experiment.journal.jsonl";
    const concurrentEntry = entry("concurrent");
    let content: string | undefined;
    let observedMissingRead = false;
    const fs = {
      mkdir: async () => undefined,
      readFile: async () => {
        if (!observedMissingRead) {
          observedMissingRead = true;
          content = `${JSON.stringify(concurrentEntry)}\n`;
          const error = new Error("missing") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        return content ?? "";
      },
      writeFile: async (_path: string, next: string) => {
        content = next;
      }
    } as unknown as ExperimentFileSystem;
    const journal = new ExperimentJournal(journalPath, fs);

    await journal.init();

    await expect(journal.readAll()).resolves.toEqual([]);
    expect(content).toBe("");
  });
});

function entry(commit: string): JournalEntry {
  return {
    commit,
    status: "keep",
    durationMs: 1,
    timestamp: "2026-05-25T00:00:00.000Z",
    output: "",
    agentOutput: ""
  };
}
```

Run the probe:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/experiment-loop/src/__probe__.test.ts > experiment journal initialization race repro > overwrites an entry appended after its missing-file read
```

Remove the disposable probe after validation.

## Observed Behavior

The probe makes the initial journal read report `ENOENT` while simulating another execution successfully writing a valid `concurrent` entry immediately afterward. `init()` then writes an empty string to the same path; `readAll()` returns no entries and the concurrently created history is erased.

## Expected Behavior

Journal initialization should create an absent sidecar exclusively or otherwise preserve a journal that appears after the initial existence check instead of overwriting valid concurrent history.

## Impact

Two experiment commands starting near the same time can silently lose the first successfully logged result during sidecar initialization. Because the resulting journal is valid but empty, experiment progress, baseline selection, and audit history can omit a completed attempt without surfacing any corruption or conflict to users.
