# Project config initialization race overwrites concurrently created config

## Summary

The exported `@poe-code/poe-code-config` `initProjectConfig()` API checks whether a project config path exists and then writes `{}` without using exclusive creation. If another operation creates a valid project configuration after the absence check but before the write, initialization reports `"created"` and silently replaces the newly created configuration with an empty document.

## Reproduction

From the repository root, add a disposable probe at `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { initProjectConfig } from "./inspect.js";

describe("project config initializer create race repro", () => {
  it("overwrites configuration created after its existence check", async () => {
    const targetPath = "/repo/.poe-code/config.json";
    const fs = createMockFs({}, "/home/test");
    fs.directories.add("/repo");
    const originalStat = fs.stat.bind(fs);
    let checkedTarget = false;

    fs.stat = async (path) => {
      const result = await originalStat(path).catch((error) => {
        if (path === targetPath && !checkedTarget) {
          checkedTarget = true;
          fs.files[targetPath] = '{"core":{"apiKey":"concurrent-value"}}\n';
        }
        throw error;
      });
      return result;
    };

    await expect(initProjectConfig(fs, targetPath)).resolves.toBe("created");
    expect(fs.getContent(targetPath)).toBe("{}\n");
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/poe-code-config/src/__probe__.test.ts > project config initializer create race repro > overwrites configuration created after its existence check
```

Remove the disposable probe after validation.

## Observed Behavior

After `initProjectConfig()` observes that `/repo/.poe-code/config.json` is absent, the probe simulates a concurrent writer creating a valid document containing a `core.apiKey` value. The initializer then resolves with `"created"`, and the retained file content is only `{}` followed by a newline; the concurrent configuration has been silently overwritten.

## Expected Behavior

Project config initialization should create its empty document exclusively, returning `"already-exists"` or otherwise preserving any file that appears before publication instead of overwriting it.

## Impact

Concurrent CLI invocations, editor setup, or another initialization process can lose valid newly written project configuration during `config init`. Because initialization reports success and leaves syntactically valid empty JSON, lost settings may go unnoticed until downstream commands behave as though configuration was never provided.
