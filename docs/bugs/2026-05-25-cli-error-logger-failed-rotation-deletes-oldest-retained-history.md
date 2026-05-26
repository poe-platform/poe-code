# CLI Error Logger Failed Rotation Deletes Oldest Retained History

## Summary

The CLI `ErrorLogger` rotates full error logs by deleting the oldest backup before renaming newer backups into place. If a later rename step fails, the logger swallows the rotation failure and appends the new entry to the current log, while the oldest retained diagnostic history has already been irreversibly deleted.

## Reproduction

Create a disposable Vitest probe at `src/cli/__probe__.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { ErrorLogger } from "./error-logger.js";

describe("error logger failed rotation ordering", () => {
  it("deletes the oldest backup before a later rotation step rejects", () => {
    const logDir = "/home/user/.poe-code/logs";
    const logFile = path.join(logDir, "errors.log");
    const backup1 = `${logFile}.1`;
    const backup2 = `${logFile}.2`;
    const fs = createFsFromVolume(Volume.fromJSON({
      [logFile]: "current log at limit",
      [backup1]: "newer history",
      [backup2]: "oldest retained history"
    }));
    vi.spyOn(fs, "renameSync").mockImplementation((source: string, target: string) => {
      if (source === backup1 && target === backup2) {
        throw new Error("rotation rename denied");
      }
      return createFsFromVolume(Volume.fromJSON({})).renameSync(source, target);
    });
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new ErrorLogger({
      fs: fs as never,
      logDir,
      logToStderr: false,
      maxSize: 1,
      maxBackups: 2,
      now: () => new Date("2026-05-25T00:00:00.000Z")
    });

    logger.logWarning("new warning");

    const remaining = fs.existsSync(backup2) ? fs.readFileSync(backup2, "utf8") : null;
    console.log(JSON.stringify({ oldestExists: fs.existsSync(backup2), current: fs.readFileSync(logFile, "utf8"), remaining }));
    expect(fs.existsSync(backup2)).toBe(false);
    expect(fs.readFileSync(logFile, "utf8")).toContain("new warning");
    expect(stderr).toHaveBeenCalledWith("Error during log rotation:", expect.any(Error));
  });
});
```

Run:

```sh
npm exec -- vitest run src/cli/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"oldestExists":false,"current":"current log at limit[2026-05-25T00:00:00.000Z] WARN: new warning\n","remaining":null}
✓ src/cli/__probe__.test.ts > error logger failed rotation ordering > deletes the oldest backup before a later rotation step rejects
```

Remove the disposable probe after validation.

## Observed Behavior

`writeEntry()` performs rotation before appending each new log event at `src/cli/error-logger.ts:120` through `src/cli/error-logger.ts:138`. `rotateIfNeeded()` catches rotation failures and only writes an error to stderr at `src/cli/error-logger.ts:164` through `src/cli/error-logger.ts:182`. Its `performRotation()` implementation deletes `errors.log.2` first at `src/cli/error-logger.ts:185` through `src/cli/error-logger.ts:195`, then attempts to rename `errors.log.1` into that slot at `src/cli/error-logger.ts:197` through `src/cli/error-logger.ts:203`. In the probe, that rename rejects after the oldest backup has been removed; logging then proceeds to append the new warning to `errors.log`, leaving no `errors.log.2` history.

## Expected Behavior

If rotation cannot complete, existing retained log backups should remain intact, or the append should fail in a way that clearly reports partial rotation. Backup retention should not delete diagnostic history until replacement placement is known to succeed.

## Impact

A permission, rename, or filesystem failure during ordinary CLI log rotation can silently discard the oldest retained error evidence while subsequent logging still appears functional. This makes failure diagnosis and incident reconstruction incomplete precisely when the filesystem is already behaving unreliably.
