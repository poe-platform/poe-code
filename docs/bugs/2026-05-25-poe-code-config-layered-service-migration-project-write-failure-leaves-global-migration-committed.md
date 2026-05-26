# Poe Code Config Layered Service Migration Project Write Failure Leaves Global Migration Committed

## Summary

The exported `loadConfiguredServices()` API migrates legacy configured-service metadata in the global config and then independently migrates the project config before returning merged data. If the project migration write fails, the read rejects after the global config has already been rewritten with inferred metadata, leaving only one layer migrated.

## Reproduction

Create a disposable Vitest probe at `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "@poe-code/config-mutations";
import { loadConfiguredServices } from "./configured-services.js";

describe("multi-layer configured-service metadata migration failure", () => {
  it("persists global migration before a project migration write rejects", async () => {
    const globalPath = "/home/user/.poe-code/config.json";
    const projectPath = "/workspace/.poe-code/config.json";
    const base = createFsFromVolume(Volume.fromJSON({
      [globalPath]: JSON.stringify({ configured_services: { codex: { files: ["/global"] } } }),
      [projectPath]: JSON.stringify({ configured_services: { opencode: { files: ["/project"] } } }),
    })).promises as unknown as FileSystem;
    const fs: FileSystem = {
      ...base,
      async writeFile(filePath, data, options) {
        if (filePath === projectPath) throw new Error("project write offline");
        await base.writeFile(filePath, data, options);
      },
    };

    await expect(loadConfiguredServices({ fs, filePath: globalPath, projectFilePath: projectPath }))
      .rejects.toThrow("project write offline");

    const output = {
      global: JSON.parse(await base.readFile(globalPath, "utf8")),
      project: JSON.parse(await base.readFile(projectPath, "utf8")),
    };
    console.log(JSON.stringify(output));
    expect(output.global.configured_services.codex).toMatchObject({ provider: "poe", apiShape: "openai-responses" });
    expect(output.project.configured_services.opencode).toEqual({ files: ["/project"] });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"global":{"configured_services":{"codex":{"files":["/global"],"provider":"poe","apiShape":"openai-responses"}}},"project":{"configured_services":{"opencode":{"files":["/project"]}}}}
✓ packages/poe-code-config/src/__probe__.test.ts > multi-layer configured-service metadata migration failure > persists global migration before a project migration write rejects
```

Remove the disposable probe after validation.

## Observed Behavior

`loadConfiguredServices()` runs `migrateConfiguredServicesIfNeeded()` for the global file at `packages/poe-code-config/src/configured-services.ts:47` and then for the distinct project file at `packages/poe-code-config/src/configured-services.ts:49`, before reading merged results. The migration helper persists derived `provider` and `apiShape` fields with `writeScope()` at `packages/poe-code-config/src/configured-services.ts:141`. In the probe, the global write succeeds, the project write rejects, and the public read rejects while the global document remains durably migrated and the project document remains legacy-formatted.

## Expected Behavior

A merged configuration read that performs automatic migrations should either commit all affected layers together or leave both documents unchanged if any layer cannot be persisted. A rejected read should not silently commit only the earlier layer's normalization.

## Impact

Transient project-file permission or storage failures can make a supposedly failed read rewrite global service state while project service metadata remains unmigrated. Users and subsequent commands observe different persistence state depending on which layer is loaded next, complicating retries, dry-run reasoning, configuration review, and recovery of inherited service configuration.
