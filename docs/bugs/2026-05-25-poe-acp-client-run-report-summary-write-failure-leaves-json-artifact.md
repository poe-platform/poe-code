# Poe Acp Client Run Report Summary Write Failure Leaves Json Artifact

## Summary

`@poe-code/poe-acp-client` persists a run report as two companion artifacts: a structured JSON file and a text summary file. `saveRunReport()` writes the JSON artifact first and then writes the text summary; if the second write fails, the public save operation rejects after leaving an incomplete report bundle containing only the JSON artifact.

## Reproduction

Create a disposable probe at `packages/poe-acp-client/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { saveRunReport, type RunReport } from "./run-report.js";

const report: RunReport = {
  runId: "run-1",
  startTime: "2026-05-25T00:00:00.000Z",
  endTime: "2026-05-25T00:00:01.000Z",
  exitStatus: "success",
  toolCalls: [],
  usage: { used: 1, size: 2, updates: 1 },
  errors: []
};

describe("run report summary failure probe", () => {
  it("rejects after persisting the JSON report when summary writing fails", async () => {
    const writes = new Map<string, string>();
    const fs = {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (filePath: string, data: string) => {
        if (filePath.endsWith(".txt")) {
          throw new Error("summary write failed");
        }
        writes.set(filePath, data);
      })
    };

    await expect(
      saveRunReport(report, {
        fs,
        homeDir: "/home/test",
        now: () => new Date("2026-05-25T01:02:03.004Z")
      })
    ).rejects.toThrow("summary write failed");

    expect([...writes.keys()]).toEqual([
      "/home/test/.poe-code/reports/20260525-010203-004-run-1.json"
    ]);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
```

The probe passes, showing that the JSON report write succeeds before the companion `.txt` summary write rejects. Remove the disposable probe afterward.

## Observed Behavior

`saveRunReport()` rejects with `summary write failed`, but `/home/test/.poe-code/reports/20260525-010203-004-run-1.json` has already been persisted. The expected paired summary artifact is absent, and the caller receives no returned paths indicating that one part of the report was successfully published.

## Expected Behavior

Saving a paired run-report bundle should either publish both artifacts together, remove or roll back the JSON artifact when summary publication fails, or return an explicit partial-success result that lets callers reconcile the remaining artifact. A generic rejection should not leave an apparently valid incomplete report set.

## Impact

Storage failures can leave reporting directories with JSON records that have no human-readable summary while callers believe the save failed completely. Indexers, support tooling, dashboards, or retry logic may treat the orphaned JSON file as a completed report, create duplicate report attempts, or present inconsistent run-history views.
