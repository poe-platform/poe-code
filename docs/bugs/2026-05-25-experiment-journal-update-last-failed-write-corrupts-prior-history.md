# Experiment Journal Update Last Failed Write Corrupts Prior History

## Summary

The exported `@poe-code/experiment-loop` `ExperimentJournal.updateLast()` API updates scores by rewriting the complete live journal file. If the replacement partially changes the journal before rejecting, the update fails while destroying previously readable experiment history.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { ExperimentJournal } from "./journal/journal.js";
import type { ExperimentFileSystem, JournalEntry } from "./types.js";

describe("experiment journal interrupted last-entry update", () => {
  it("destroys prior journal history when score persistence rejects", async () => {
    const journalPath = "/repo/experiment.journal.jsonl";
    const first: JournalEntry = {
      commit: "aaa1111", status: "keep", durationMs: 1, timestamp: "2026-05-25T00:00:00.000Z", output: "first"
    };
    const second: JournalEntry = {
      commit: "bbb2222", status: "keep", durationMs: 2, timestamp: "2026-05-25T00:00:01.000Z", output: "second"
    };
    const initial = `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`;
    const base = createFsFromVolume(Volume.fromJSON({ [journalPath]: initial })).promises as unknown as ExperimentFileSystem;
    const fs: ExperimentFileSystem = {
      ...base,
      async writeFile(filePath, content) {
        if (filePath === journalPath) {
          await base.writeFile(filePath, "{", "utf8");
          throw new Error("journal disk full");
        }
        await base.writeFile(filePath, content, "utf8");
      }
    };
    const journal = new ExperimentJournal(journalPath, fs);

    await expect(journal.updateLast({ scores: { tests: 42 } })).rejects.toThrow("journal disk full");
    const raw = await base.readFile(journalPath, "utf8");
    console.log(JSON.stringify({ raw }));
    expect(raw).toBe("{");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"{"}
✓ packages/experiment-loop/src/__probe__.test.ts > experiment journal interrupted last-entry update > destroys prior journal history when score persistence rejects
```

Remove the disposable probe after validation.

## Observed Behavior

`ExperimentJournal.updateLast()` reads the existing history, modifies the final entry, and replaces the entire live journal with `this.fs.writeFile()` at `packages/experiment-loop/src/journal/journal.ts:50` through `packages/experiment-loop/src/journal/journal.ts:66`. In the probe, an existing two-entry JSONL journal is valid before the score update; the write rejects with `"journal disk full"` after replacing its content with malformed JSON `"{"`, so both prior entries are no longer recoverable through normal journal reads.

## Expected Behavior

Updating derived fields on the last experiment entry should preserve the prior valid journal if the replacement cannot be committed completely. Whole-file journal rewrites should be atomic or use recovery semantics that retain existing readable history after write failures.

## Impact

Scoring or evaluation updates can erase prior experiment decisions, outputs, and commits during transient storage failures. A failed post-run score patch therefore risks losing the authoritative experiment history that users and subsequent loop runs depend on for progress and baseline state.
