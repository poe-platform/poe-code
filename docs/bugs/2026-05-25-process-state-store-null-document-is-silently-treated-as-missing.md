# Process state store null document is silently treated as missing

## Summary

The exported `@poe-code/process-launcher` `createStateStore()` API accepts a persisted `state.json` file whose valid JSON content is `null`. Rather than rejecting the malformed process-state document, `read()` returns the same sentinel used for a missing file and `list()` silently omits the existing state directory entirely.

## Reproduction

Create a disposable Vitest probe at `packages/process-launcher/src/state/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { createStateStore } from "./state-store.js";
import type { LauncherFileSystem } from "../types.js";

describe("process state store null JSON entry", () => {
  it("silently reports a persisted null state as absent", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({ "/state/job/state.json": "null\n" }, "/")
    ).promises as unknown as LauncherFileSystem;
    const store = createStateStore("/state", fs);

    await expect(store.read("job")).resolves.toBeNull();
    await expect(store.list()).resolves.toEqual([]);
    await expect(fs.readFile("/state/job/state.json", "utf8")).resolves.toBe("null\n");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/process-launcher/src/state/__probe__.test.ts --reporter verbose
rm -f packages/process-launcher/src/state/__probe__.test.ts
```

## Observed Behavior

The state file remains present on disk, but both exported read surfaces report it as if no state exists:

```text
✓ packages/process-launcher/src/state/__probe__.test.ts > process state store null JSON entry > silently reports a persisted null state as absent
```

The observed result is equivalent to:

```json
{"file":"null\n","read":null,"list":[]}
```

`createStateStore().read()` in `packages/process-launcher/src/state/state-store.ts` parses persisted JSON and casts it to `ProcessState` without validating that it is an object of the required shape. The API also uses `null` as the not-found return value, so a stored JSON `null` is indistinguishable from a missing file. `list()` calls `read(entry)` and adds entries only when the result is non-null, thereby hiding the malformed but existing process-state directory rather than reporting corruption.

## Expected Behavior

Persisted process-state documents should be validated after parsing. A file containing `null` is not a valid `ProcessState` and should produce an actionable invalid-state error; it must not be conflated with a file that does not exist.

## Impact

A truncated, manually edited, or corrupted state file can make a managed process disappear from inspection and listing APIs while its state directory remains on disk and related processes may still exist. Operators and automation can incorrectly conclude that no managed process is registered, skip cleanup or recovery, and create conflicting replacement state over an undiagnosed corrupted record.
