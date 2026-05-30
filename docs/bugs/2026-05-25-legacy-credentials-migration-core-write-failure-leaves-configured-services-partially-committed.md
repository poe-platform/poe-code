---
name: "Legacy Credentials Migration Core Write Failure Leaves Configured Services Partially Committed"
---

# Legacy Credentials Migration Core Write Failure Leaves Configured Services Partially Committed

## Summary

When `loadConfig()` migrates a legacy `credentials.json` document containing both `configured_services` and `apiKey`, it writes the configured-services scope before writing the core credential scope. If the later core write fails, the call rejects and retains the legacy source file, but the current config already contains migrated configured-services data without the matching API key.

## Reproduction

Create a disposable Vitest probe at `src/services/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { loadConfig } from "./config.js";
import type { FileSystem } from "../utils/file-system.js";

describe("legacy credentials multi-scope migration failure", () => {
  it("commits configured services before core api key write rejects", async () => {
    const root = "/home/user/.poe-code";
    const configPath = path.join(root, "config.json");
    const legacyPath = path.join(root, "credentials.json");
    const base = createFsFromVolume(Volume.fromJSON({
      [legacyPath]: JSON.stringify({
        apiKey: "secret",
        configured_services: { codex: { files: ["/home/user/.codex/config.toml"] } },
      }),
    })).promises as unknown as FileSystem;
    let writes = 0;
    const fs: FileSystem = {
      ...base,
      async writeFile(filePath, data, options) {
        if (filePath === configPath) {
          writes += 1;
          if (writes === 2) throw new Error("core write offline");
        }
        await base.writeFile(filePath, data, options);
      },
    };

    await expect(loadConfig({ fs, filePath: configPath })).rejects.toThrow("core write offline");
    const output = {
      config: JSON.parse(await base.readFile(configPath, "utf8")),
      legacyStillPresent: await base.readFile(legacyPath, "utf8").then(() => true, () => false),
    };
    console.log(JSON.stringify(output));

    expect(output.config.configured_services.codex).toBeDefined();
    expect(output.config.core).toBeUndefined();
    expect(output.legacyStillPresent).toBe(true);
  });
});
```

Run:

```sh
npm exec -- vitest run src/services/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"config":{"configured_services":{"codex":{"provider":"poe","files":["/home/user/.codex/config.toml"]}}},"legacyStillPresent":true}
✓ src/services/__probe__.test.ts > legacy credentials multi-scope migration failure > commits configured services before core api key write rejects
```

Remove the disposable probe after validation.

## Observed Behavior

`migrateLegacyCredentialsFile()` writes `configured_services` first at `src/services/config.ts:234` and only afterward attempts to write `core.apiKey` at `src/services/config.ts:238`. In the probe, the second config write rejects, so `loadConfig()` fails and does not unlink `credentials.json`; however, the newly created `config.json` has already persisted the service metadata and has no `core` credential scope.

## Expected Behavior

Legacy credential migration should be atomic across all scopes from the source document. If persisting the API key fails, the current config should not retain a separately committed configured-services migration, or migration should safely roll back before rejecting.

## Impact

A transient write failure during first-run migration can leave configuration split across both legacy and current files while reporting migration failure. Retries, service status checks, or later cleanup can observe a tool as configured without its matching credential, causing misleading state and requiring manual recovery to understand which copy is authoritative.
