# Legacy Credentials Migration Drops a `__proto__` Configured Service Before Deleting Its Source

## Summary

The public configuration-loading path migrates legacy `credentials.json` data into the current poe-code config on first read, but silently drops a configured service named `__proto__` during normalization and then deletes the legacy source file. This makes the lost service entry unrecoverable from the normal migration input.

## Reproduction

Create a disposable Vitest probe at `src/services/__probe__.test.ts`:

```ts
import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { resolveConfigPath } from "@poe-code/poe-code-config";
import type { FileSystem } from "../utils/file-system.js";
import { loadConfig, loadConfiguredServices } from "./config.js";

describe("legacy config prototype-key service repro", () => {
  it("drops a legacy __proto__ configured service and deletes its source file", async () => {
    const homeDir = "/home/user";
    const configPath = resolveConfigPath(homeDir);
    const legacyPath = path.join(path.dirname(configPath), "credentials.json");
    const volume = new Volume();
    volume.mkdirSync(path.dirname(configPath), { recursive: true });
    const fs = createFsFromVolume(volume).promises as unknown as FileSystem;
    await fs.writeFile(
      legacyPath,
      JSON.stringify({
        apiKey: "test-key",
        configured_services: JSON.parse('{"__proto__":{"provider":"poe","files":["/tmp/proto"]}}')
      }),
      "utf8"
    );

    await expect(loadConfig({ fs, filePath: configPath })).resolves.toBe("test-key");
    await expect(loadConfiguredServices({ fs, filePath: configPath })).resolves.toEqual({});
    await expect(fs.readFile(legacyPath, "utf8")).rejects.toThrow();
  });
});
```

Run:

```sh
npm exec -- vitest run src/services/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that migration preserves the API key while discarding the configured service and removing the legacy file. Remove the disposable probe after validation.

## Observed Behavior

When `loadConfig()` encounters only a legacy `credentials.json` containing an API key and a `configured_services.__proto__` entry, it returns the API key successfully, `loadConfiguredServices()` subsequently returns `{}`, and the legacy credentials file has been removed. In `src/services/config.ts`, `migrateLegacyCredentialsFile()` normalizes the parsed document, writes retained values, and unconditionally unlinks the source; `normalizeConfiguredServices()` builds `entries = {}` and copies each user-stored service name through `entries[key] = ...`, so a `__proto__` service is no longer an own service before migration decides whether any configured services exist.

## Expected Behavior

Legacy migration should preserve every valid configured service entry, including a service key named `__proto__`, or reject unsupported stored keys without deleting the original source document that contains them.

## Impact

A first configuration read can irreversibly erase a legacy configured-service record while appearing to migrate successfully. Users may retain credentials but silently lose tool/provider setup, and the deleted source file prevents straightforward recovery or diagnosis of the missing migrated service.
