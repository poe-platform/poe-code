# Process launcher list crashes on numeric persisted spec ID

## Summary

The exported `@poe-code/process-launcher` `listManagedProcesses()` API loads persisted `spec.json` documents without validating the `id` field type and then sorts records by calling `.localeCompare()` on that stored value. A syntactically valid specification with a numeric `id` can therefore make process listing throw instead of returning records or reporting invalid persisted state.

## Reproduction

From the repository root, create and execute this disposable in-memory Vitest probe, then remove it:

```sh
cat > packages/process-launcher/src/__probe__.test.ts <<'EOF'
import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { expect, it } from "vitest";
import { listManagedProcesses, type LauncherFileSystem } from "@poe-code/process-launcher";

it("throws when a later persisted spec id is numeric during process listing", async () => {
  const baseDir = "/launch";
  const rawFs = createFsFromVolume(
    Volume.fromJSON({
      [path.join(baseDir, "alpha", "spec.json")]: JSON.stringify({
        id: "alpha",
        command: "server",
        restart: "never"
      }),
      [path.join(baseDir, "zulu", "spec.json")]: JSON.stringify({
        id: 42,
        command: "server",
        restart: "never"
      })
    }, "/")
  ).promises;
  const fs = rawFs as unknown as LauncherFileSystem;

  await expect(listManagedProcesses({ baseDir, fs })).rejects.toThrow(
    "leftId.localeCompare is not a function"
  );
});
EOF
npm exec -- vitest run packages/process-launcher/src/__probe__.test.ts --reporter verbose
rm packages/process-launcher/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/process-launcher/src/__probe__.test.ts > throws when a later persisted spec id is numeric during process listing
Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

When `/launch/zulu/spec.json` contains `{ "id": 42, "command": "server", "restart": "never" }` alongside another process whose persisted ID is a string, `listManagedProcesses()` rejects with `TypeError: leftId.localeCompare is not a function`. The failure depends on comparator order because it occurs when the malformed numeric ID is the left sort operand.

`readSpec()` at `packages/process-launcher/src/launcher.ts:556` through `packages/process-launcher/src/launcher.ts:560` parses the specification JSON and casts it to `ProcessSpec` without validating required property types. `listManagedProcesses()` loads those records at `packages/process-launcher/src/launcher.ts:219` through `packages/process-launcher/src/launcher.ts:236`, then uses `left.spec?.id` directly as a sort key and invokes `.localeCompare()` at `packages/process-launcher/src/launcher.ts:238` through `packages/process-launcher/src/launcher.ts:241`. A numeric persisted ID therefore reaches a string-only operation.

## Expected Behavior

Listing managed processes should validate persisted specifications and either return valid records or produce a stable invalid-record diagnostic identifying the corrupt entry. It should not crash through an incidental string-method call while sorting.

## Impact

A single malformed or externally edited launch specification can prevent operators and automation from viewing the managed-process inventory through `listManagedProcesses()` and the `launch status` SDK/CLI path that relies on it. The sort-order-dependent exception also makes diagnosis inconsistent as neighboring records change.
