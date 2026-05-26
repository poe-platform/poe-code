# Poe ACP Run Report Summary Failure Leaves Incomplete Report Bundle

## Summary

The exported `saveRunReport()` persists a JSON report and its human-readable summary sequentially, without staging or cleanup. If summary persistence fails, the API rejects after the JSON artifact has already been committed, leaving a report bundle that appears present on disk but is incomplete.

## Reproduction

Create a disposable Vitest probe at `packages/poe-acp-client/src/__probe__.test.ts`:

```ts
import { fs as memfs, vol } from "memfs";
import { expect, it } from "vitest";

import { saveRunReport, type RunReport, type RunReportFileSystem } from "./run-report.js";

it("rejects after committing JSON when summary persistence fails", async () => {
  vol.reset();
  const fs: RunReportFileSystem = {
    mkdir: memfs.promises.mkdir as RunReportFileSystem["mkdir"],
    async writeFile(filePath, data, options) {
      if (filePath.endsWith(".txt")) {
        throw new Error("summary disk full");
      }
      await memfs.promises.writeFile(filePath, data, options);
    }
  };
  const report: RunReport = {
    runId: "session-a",
    startTime: "2026-05-25T12:00:00.000Z",
    endTime: "2026-05-25T12:01:00.000Z",
    exitStatus: "success",
    toolCalls: [],
    usage: { used: 1, size: 2, updates: 1 },
    errors: []
  };

  await expect(
    saveRunReport(report, { fs, homeDir: "/home", now: () => new Date("2026-05-25T12:02:00.000Z") })
  ).rejects.toThrow("summary disk full");

  const reports = vol.readdirSync("/home/.poe-code/reports") as string[];
  expect(reports).toEqual(["20260525-120200-000-session-a.json"]);
  expect(vol.readFileSync("/home/.poe-code/reports/20260525-120200-000-session-a.json", "utf8"))
    .toContain('"runId": "session-a"');
});
```

Run:

```sh
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/poe-acp-client/src/__probe__.test.ts > rejects after committing JSON when summary persistence fails
```

Remove the disposable probe after validation.

## Observed Behavior

`saveRunReport()` computes paired `.json` and `.txt` output paths and writes the JSON before writing the text summary at `packages/poe-acp-client/src/run-report.ts:135` through `packages/poe-acp-client/src/run-report.ts:159`. In the probe, the injected filesystem accepts the JSON write and rejects the summary write. The public call rejects with `summary disk full`, but `/home/.poe-code/reports` already contains `20260525-120200-000-session-a.json` and no corresponding `.txt` summary.

## Expected Behavior

Saving a run report bundle should either publish both promised artifacts or leave no new visible report when either artifact cannot be persisted. A rejected save should not leave partial report state that downstream readers may mistake for a complete successful export.

## Impact

ACP report generation can produce orphaned machine-readable reports without their expected operator-facing summaries during ordinary filesystem failures. Tools or users enumerating the reports directory may consume incomplete exports, while callers receiving a rejection cannot tell that one half of the report was already committed unless they perform cleanup themselves.
