# Toolcraft Error Reports Same Minute Command Collision Overwrites Prior Diagnostic

## Summary

The exported Toolcraft `writeErrorReport()` helper names diagnostics using only a minute-resolution timestamp and the command path slug. Two failures for the same command during one minute target the same log path, so the second report silently overwrites and erases the first diagnostic.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { writeErrorReport } = await import("./error-report.js");

describe("toolcraft same-timestamp error reports", () => {
  afterEach(() => vi.useRealTimers());

  it("overwrites the first diagnostic report for the same command", async () => {
    vol.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:34:56.789Z"));
    const first = await writeErrorReport({
      commandPath: "widgets.create",
      error: new Error("first failure"),
      errorReports: true,
      projectRoot: "/repo"
    });
    const second = await writeErrorReport({
      commandPath: "widgets.create",
      error: new Error("second failure"),
      errorReports: true,
      projectRoot: "/repo"
    });

    const reports = vol.readdirSync("/repo/.toolcraft/errors") as string[];
    const raw = vol.readFileSync(first!.absolutePath, "utf8") as string;
    console.log(JSON.stringify({ samePath: first!.absolutePath === second!.absolutePath, reports, hasFirst: raw.includes("first failure"), hasSecond: raw.includes("second failure") }));
    expect(first!.absolutePath).toBe(second!.absolutePath);
    expect(reports).toHaveLength(1);
    expect(raw).not.toContain("first failure");
    expect(raw).toContain("second failure");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"samePath":true,"reports":["2026-05-25T1234-widgets-create.log"],"hasFirst":false,"hasSecond":true}
✓ packages/toolcraft/src/__probe__.test.ts > toolcraft same-timestamp error reports > overwrites the first diagnostic report for the same command
```

Remove the disposable probe after validation.

## Observed Behavior

`formatTimestamp()` emits only year, month, day, hour, and minute at `packages/toolcraft/src/error-report.ts:117` through `packages/toolcraft/src/error-report.ts:125`. `writeErrorReport()` combines that value with the command path slug to calculate a single filename and writes directly to it at `packages/toolcraft/src/error-report.ts:460` through `packages/toolcraft/src/error-report.ts:480`. In the probe, two different errors from `widgets.create` during `2026-05-25T12:34` both return the path `2026-05-25T1234-widgets-create.log`; the directory contains only one file, whose text contains only `second failure`.

## Expected Behavior

Every enabled error-report emission should preserve its own diagnostic output, including repeated failures for the same command within a minute. Report names should include collision-resistant uniqueness or use exclusive creation plus disambiguation rather than replacing an existing report silently.

## Impact

Repeated, parallel, or retry-driven Toolcraft failures can erase earlier error context, stack traces, request transcripts, and redacted diagnostics under normal timing. Since a full minute shares one namespace per command path, report retention is unreliable even without high concurrency.
