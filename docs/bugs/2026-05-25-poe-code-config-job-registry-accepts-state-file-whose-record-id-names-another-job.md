# Poe code config job registry accepts state file whose record ID names another job

## Summary

`@poe-code/poe-code-config` maps detached job lookup to `<requested-id>.json` filenames but does not verify that the stored record's `id` matches that filename or requested key. A request for `requested-job` can therefore return a valid-looking record whose actual `id`, environment, working directory, and command belong to `other-job`.

## Reproduction

Add the following temporary probe as `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createJobRegistry, type JobEntry, type StateFileSystem } from "./state/jobs.js";

describe("job registry record identity probe", () => {
  it("returns an entry whose id does not match the requested state filename", async () => {
    const stored: JobEntry = {
      id: "other-job",
      env_id: "other-env",
      env_kind: "docker",
      tool: "node",
      argv: ["node"],
      cwd: "/other",
      started_at: "2026-05-25T00:00:00.000Z",
      status: "running",
    };
    const filePath = path.join("/home/tester", ".poe-code", "state", "jobs", "requested-job.json");
    const fs = createFsFromVolume(Volume.fromJSON({
      [filePath]: `${JSON.stringify(stored)}\n`,
    }, "/")).promises as unknown as StateFileSystem;
    const registry = createJobRegistry("/home/tester", fs);

    await expect(registry.get("requested-job")).resolves.toEqual(stored);
    await expect(registry.list()).resolves.toEqual([stored]);
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
rm packages/poe-code-config/src/__probe__.test.ts
nl -ba packages/poe-code-config/src/state/jobs.ts | sed -n '36,57p;87,112p;216,242p'
nl -ba src/cli/commands/runtime/jobs/shared.ts | sed -n '20,54p'
```

The reproduction passes:

```text
✓ packages/poe-code-config/src/__probe__.test.ts > job registry record identity probe > returns an entry whose id does not match the requested state filename
```

## Observed Behavior

`createJobRegistry()` constructs a filename from the lookup key and returns the parsed contents directly in `packages/poe-code-config/src/state/jobs.ts:36` through `packages/poe-code-config/src/state/jobs.ts:57`. Its `list()` implementation likewise trusts each JSON record found beneath the jobs directory at `packages/poe-code-config/src/state/jobs.ts:87` through `packages/poe-code-config/src/state/jobs.ts:112`. Unlike the adjacent template registry, which requires each stored entry's `hash` to match its map key, `parseJobEntry()` and `isJobEntry()` at `packages/poe-code-config/src/state/jobs.ts:216` through `packages/poe-code-config/src/state/jobs.ts:242` validate field types but never compare the record `id` to the filename key. Downstream explicit runtime-job selection retrieves by the user-supplied ID and then attaches using fields from the returned record in `src/cli/commands/runtime/jobs/shared.ts:20` through `src/cli/commands/runtime/jobs/shared.ts:54`.

## Expected Behavior

Each persisted job record should be bound to its storage key. Reading or listing `requested-job.json` should reject or ignore content whose `id` is not `requested-job`, preventing a filename lookup from silently resolving to a different job identity.

## Impact

Corrupted or manipulated local job-state files can make `runtime jobs` commands target an unexpected environment and command record despite the identifier selected by the user. This can misdirect log access, attachment, synchronization, or stop operations to another persisted job and makes job state unreliable as an identity map.
