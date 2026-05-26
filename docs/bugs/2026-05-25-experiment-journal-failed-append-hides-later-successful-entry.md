# Experiment journal failed append hides later successful entry

## Summary

The exported experiment journal `log()` operation appends serialized entries directly to the active JSONL history. If an append fails after writing an unterminated partial JSON object, the journal remains malformed at its tail; a later successful append on the same line is then silently omitted by `readAll()` rather than being returned as a valid later experiment record.

## Reproduction

From the repository root, add a disposable probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ExperimentJournal } from "./journal/journal.js";
import type { ExperimentFileSystem, JournalEntry } from "./types.js";

describe("experiment journal interrupted append repro", () => {
  it("loses a later successful entry behind a malformed partial append", async () => {
    const journalPath = "/repo/experiment.journal.jsonl";
    let content = "";
    let failNextAppend = false;
    const fs = {
      mkdir: async () => undefined,
      readFile: async () => content,
      writeFile: async (_path: string, next: string) => {
        content = next;
      },
      appendFile: async (_path: string, next: string) => {
        if (failNextAppend) {
          failNextAppend = false;
          content += '{"commit":"interrupted",';
          throw new Error("append interrupted");
        }
        content += next;
      }
    } as unknown as ExperimentFileSystem;
    const journal = new ExperimentJournal(journalPath, fs);
    const first = entry("first");
    const later = entry("later");

    await journal.log(first);
    failNextAppend = true;
    await expect(journal.log(entry("failed"))).rejects.toThrow("append interrupted");
    await journal.log(later);

    await expect(journal.readAll()).resolves.toEqual([first]);
  });
});

function entry(commit: string): JournalEntry {
  return {
    commit,
    status: "discard",
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
✓ packages/experiment-loop/src/__probe__.test.ts > experiment journal interrupted append repro > loses a later successful entry behind a malformed partial append
```

Remove the disposable probe after validation.

## Observed Behavior

After the first valid entry, the failed `log()` call leaves an unterminated JSON fragment in the journal. A later `log()` call succeeds and appends a complete valid entry, but `readAll()` returns only the first record. The later entry is concatenated after malformed content and dropped during the parser's failed recovery of that line.

## Expected Behavior

A failed journal append should not leave malformed content that suppresses later successful records. Appends should be durable per entry, or readers should preserve valid records following a partial failed tail rather than silently hiding them.

## Impact

A transient disk or interrupted-write error can make later successful experiments disappear from journal-based reporting and baseline reconstruction. Subsequent loop decisions, status output, and audit review can operate on stale history even after new records were successfully appended, undermining reproducibility and recovery.
