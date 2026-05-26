# Poe code config job registry persists infinite exit code as unreadable null state

## Summary

`@poe-code/poe-code-config`'s exported job registry accepts non-finite numeric `exit_code` values such as `Infinity` as valid job entries. When it persists that entry with `JSON.stringify()`, the exit code becomes `null`; subsequent reads reject the registry's own stored file as invalid state.

## Reproduction

Add the following temporary probe as `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createJobRegistry, type StateFileSystem } from "./state/jobs.js";

describe("job registry non-finite exit code probe", () => {
  it("accepts Infinity then persists it as null and cannot reload its own state", async () => {
    const fs = createFsFromVolume(new Volume()).promises as unknown as StateFileSystem;
    const registry = createJobRegistry("/home/tester", fs);

    await registry.put({
      id: "job-infinite",
      env_id: "env-1",
      env_kind: "host",
      tool: "node",
      argv: ["node"],
      cwd: "/repo",
      started_at: "2026-05-25T00:00:00.000Z",
      status: "exited",
      exit_code: Infinity,
      exited_at: "2026-05-25T00:00:01.000Z",
    });

    const stored = await fs.readFile(
      "/home/tester/.poe-code/state/jobs/job-infinite.json",
      "utf8"
    );

    expect(stored).toContain('"exit_code": null');
    await expect(registry.get("job-infinite")).rejects.toThrow("Invalid job state file.");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
rm packages/poe-code-config/src/__probe__.test.ts
nl -ba packages/poe-code-config/src/state/jobs.ts | sed -n '7,29p;47,83p;149,165p;211,242p'
```

The reproduction passes:

```text
✓ packages/poe-code-config/src/__probe__.test.ts > job registry non-finite exit code probe > accepts Infinity then persists it as null and cannot reload its own state
```

## Observed Behavior

`JobEntry` declares `exit_code?: number` in `packages/poe-code-config/src/state/jobs.ts:7` through `packages/poe-code-config/src/state/jobs.ts:19`, and `put()` accepts entries after validation at `packages/poe-code-config/src/state/jobs.ts:47` through `packages/poe-code-config/src/state/jobs.ts:57`. That validation permits any JavaScript number because `isJobEntry()` checks only `typeof value.exit_code === "number"` at `packages/poe-code-config/src/state/jobs.ts:211` through `packages/poe-code-config/src/state/jobs.ts:242`. The accepted `Infinity` is then written with `JSON.stringify()` at `packages/poe-code-config/src/state/jobs.ts:149` through `packages/poe-code-config/src/state/jobs.ts:165`, which serializes it as `null`. On the next `get()`, `parseJobEntry()` rejects the stored `null` exit code as an invalid job state file.

## Expected Behavior

The job registry should reject non-finite exit codes before persistence, or represent exit status in a format that round-trips through its JSON storage. Any entry successfully accepted by `put()` should remain readable through `get()` and `list()`.

## Impact

A caller passing a non-finite result can create a persisted detached-job record that the state API can no longer load. Runtime job listing, inspection, cleanup, and automation may fail on the corrupted file until users manually remove or repair state.
