# Poe Code Config Template Registry Failed Write Corrupts Shared Cache

## Summary

The exported runtime template registry updates its shared `templates.json` cache by overwriting the live file directly, unlike the adjacent job registry's temporary-file rename path. If a write partially modifies the file and then rejects, the operation reports failure but leaves all previously stored template entries in an unreadable JSON document.

## Reproduction

Create a disposable Vitest probe at `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createTemplateRegistry, type StateFileSystem, type TemplateEntry } from "./state/templates.js";

describe("template registry interrupted write", () => {
  it("leaves the shared template cache unreadable after a failing overwrite", async () => {
    const statePath = "/home/tester/.poe-code/state/templates.json";
    const initial = {
      docker: {
        old: { hash: "old", runtime_type: "docker", dockerfile_path: "/repo/old/Dockerfile", built_at: "2026-05-25T00:00:00.000Z", image: "old:image" },
      },
      e2b: {},
    };
    const base = createFsFromVolume(Volume.fromJSON({ [statePath]: JSON.stringify(initial) })).promises as unknown as StateFileSystem;
    const fs: StateFileSystem = {
      ...base,
      async writeFile(filePath, data, options) {
        if (filePath === statePath) {
          await base.writeFile(filePath, "{", options);
          throw new Error("disk full");
        }
        await base.writeFile(filePath, data, options);
      },
    };
    const registry = createTemplateRegistry("/home/tester", fs);
    const next: TemplateEntry = { hash: "new", runtime_type: "docker", dockerfile_path: "/repo/new/Dockerfile", built_at: "2026-05-25T01:00:00.000Z", image: "new:image" };

    await expect(registry.put("docker", next)).rejects.toThrow("disk full");
    const raw = await base.readFile(statePath, "utf8");
    console.log(JSON.stringify({ raw }));
    expect(raw).toBe("{");
    await expect(createTemplateRegistry("/home/tester", base).list("docker")).rejects.toBeInstanceOf(SyntaxError);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"{"}
✓ packages/poe-code-config/src/__probe__.test.ts > template registry interrupted write > leaves the shared template cache unreadable after a failing overwrite
```

Remove the disposable probe after validation.

## Observed Behavior

`createTemplateRegistry()` reads all cached templates from one state file at `packages/poe-code-config/src/state/templates.ts:31`. On update, `writeState()` overwrites that live file directly at `packages/poe-code-config/src/state/templates.ts:44`, and `updateState()` has no rollback or atomic replacement step at `packages/poe-code-config/src/state/templates.ts:50`. In the probe, a failed `put()` leaves `templates.json` equal to `"{"`; a subsequent `list()` throws `SyntaxError` instead of recovering the previously valid `old` template entry.

## Expected Behavior

Template-cache mutations should commit atomically, preserving the previous valid cache when the new write cannot complete. A rejected `put()` or `remove()` should not make previously persisted templates unreadable.

## Impact

A disk-full condition, interrupted filesystem operation, or storage adapter failure while updating one runtime template can destroy the entire reusable template cache. Later runtime launches and listings fail to parse stored state and can no longer reuse valid Docker or E2B templates that existed before the rejected update.
