# Toolcraft error report failed colliding write corrupts prior diagnostic

## Summary

The exported Toolcraft `writeErrorReport()` helper writes diagnostic text directly to its computed report path. Because repeated reports for a command in the same minute reuse that path, a later write that partially replaces the file before rejecting can destroy the previously retained diagnostic while failing to publish a complete replacement.

## Reproduction

From the repository root, add a disposable probe at `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  const promises = fs.promises;
  return {
    ...promises,
    writeFile: async (targetPath: string, content: string) => {
      if (String(targetPath).includes("widgets-create.log")) {
        await promises.writeFile(targetPath, "partial diagnostic", "utf8");
        throw new Error("report write interrupted");
      }
      await promises.writeFile(targetPath, content, "utf8");
    }
  };
});

const { writeErrorReport } = await import("./error-report.js");

describe("toolcraft interrupted error report replacement repro", () => {
  afterEach(() => vi.useRealTimers());

  it("rejects after corrupting a retained diagnostic at its colliding path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:34:56.789Z"));
    const reportPath = "/repo/.toolcraft/errors/2026-05-25T1234-widgets-create.log";
    vol.fromJSON({ [reportPath]: "prior diagnostic" });

    await expect(
      writeErrorReport({
        commandPath: "widgets.create",
        error: new Error("next failure"),
        errorReports: true,
        projectRoot: "/repo"
      })
    ).rejects.toThrow("report write interrupted");

    await expect(vol.promises.readFile(reportPath, "utf8")).resolves.toBe("partial diagnostic");
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/toolcraft/src/__probe__.test.ts > toolcraft interrupted error report replacement repro > rejects after corrupting a retained diagnostic at its colliding path
```

Remove the disposable probe after validation.

## Observed Behavior

With an existing report stored at the path Toolcraft calculates for `widgets.create` during `2026-05-25T12:34`, a subsequent `writeErrorReport()` rejects with `report write interrupted`, but reading that retained path afterward returns only `partial diagnostic`. The previous complete diagnostic has already been overwritten.

## Expected Behavior

If publishing a new diagnostic fails, an already retained error report should remain intact. Toolcraft should commit reports through unique or atomic publication rather than replacing a live diagnostic before the new report is safely persisted.

## Impact

A filesystem interruption while recording a repeated command failure can erase the only complete report available for debugging the earlier failure, while also failing to retain the new one. Stack traces, HTTP transcripts, and redacted diagnostic context can therefore be lost precisely when repeated errors make them most valuable.
