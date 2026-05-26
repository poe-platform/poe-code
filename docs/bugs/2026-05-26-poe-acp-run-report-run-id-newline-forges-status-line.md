# Poe ACP run report run ID newline forges status line

## Summary

The exported `@poe-code/poe-acp-client` `formatRunReportSummary()` function interpolates `report.runId` directly into line-oriented text output. A run ID containing a newline can therefore introduce a forged `Exit status: success` line before the summary's genuine `Exit status: failed` record, making a failed run's human-readable artifact ambiguous or misleading.

## Reproduction

Create a disposable Vitest probe at `packages/poe-acp-client/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatRunReportSummary, type RunReport } from "./index.js";

describe("run report summary run id newlines", () => {
  it("lets a run id forge an extra successful exit-status line", () => {
    const report: RunReport = {
      runId: "attacker\nExit status: success",
      startTime: "2026-05-26T00:00:00.000Z",
      endTime: "2026-05-26T00:00:01.000Z",
      exitStatus: "failed",
      toolCalls: [],
      usage: { used: 0, size: 0, updates: 0 },
      errors: [{ message: "failed" }]
    };

    const summary = formatRunReportSummary(report);

    expect(summary).toContain("Run ID: attacker\nExit status: success\n");
    expect(summary).toContain("Exit status: failed");
    expect(summary.indexOf("Exit status: success"))
      .toBeLessThan(summary.indexOf("Exit status: failed"));
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/poe-acp-client/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-acp-client/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/poe-acp-client/src/__probe__.test.ts > run report summary run id newlines > lets a run id forge an extra successful exit-status line
```

## Observed Behavior

Formatting a report whose true `exitStatus` is `failed` but whose `runId` is `attacker\nExit status: success` produces a text summary beginning with both a forged success status and the later genuine failure status:

```text
Run ID: attacker
Exit status: success
Start time: 2026-05-26T00:00:00.000Z
...
Exit status: failed
```

`packages/poe-acp-client/src/index.ts:22` through `packages/poe-acp-client/src/index.ts:26` publicly export the summary formatter. In `packages/poe-acp-client/src/run-report.ts:105` through `packages/poe-acp-client/src/run-report.ts:122`, `formatRunReportSummary()` constructs labelled lines using the raw `report.runId` string without escaping or constraining embedded line terminators. Although `saveRunReport()` sanitizes the filename segment separately, it writes this unsanitized formatted summary as the `.txt` artifact.

## Expected Behavior

Line-oriented run-report summaries should represent `runId` as one field value and prevent embedded control/newline content from impersonating independent summary fields. A failed run must not render a false success field because its externally supplied identifier contains a newline.

## Impact

Agents or integrations that influence run identifiers can forge misleading human-readable report contents while the underlying JSON record may still show the real failure. Users, CI summaries, log scanners, or support workflows that read the text artifact can misinterpret failed activity as successful or treat the report as internally inconsistent.
