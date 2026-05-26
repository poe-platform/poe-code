# Poe code config unconfigure constructor reports removal and rewrites empty configured services

## Summary

The exported `@poe-code/poe-code-config` `unconfigureService()` API treats an inherited `constructor` property as an existing configured service. Asking it to remove `"constructor"` from a configuration whose `configured_services` scope is empty returns `true` and rewrites the stored scope away, despite no such service having been configured.

## Reproduction

Add the following disposable test as `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { createMockFs } from "@poe-code/config-mutations/testing";
import { describe, expect, it } from "vitest";
import { unconfigureService } from "./configured-services.js";

describe("configured service inherited removal", () => {
  it("reports and writes removal for absent constructor service", async () => {
    const fs = createMockFs(
      { "~/.poe-code/config.json": JSON.stringify({ configured_services: {} }) },
      "/home/test"
    );

    await expect(
      unconfigureService({
        fs,
        filePath: "/home/test/.poe-code/config.json",
        service: "constructor"
      })
    ).resolves.toBe(true);

    expect(JSON.parse(fs.getContent("~/.poe-code/config.json")!)).toEqual({});
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
```

The test passes:

```text
✓ packages/poe-code-config/src/__probe__.test.ts > configured service inherited removal > reports and writes removal for absent constructor service
```

Remove the disposable probe after confirmation.

## Observed Behavior

`unconfigureService()` normalizes the stored service map into a normal JavaScript object, then checks `if (!(service in services))`. For `service === "constructor"`, an empty map inherits `Object.prototype.constructor`, so the API proceeds as though the configured service exists, deletes no own service entry, writes the now-empty scope through `writeScope()`, and resolves `true`. `writeScope()` removes empty scopes from the persisted JSON, changing `{ "configured_services": {} }` into `{}`.

## Expected Behavior

`unconfigureService()` should return `false` and avoid file writes when the requested service does not exist as an own configured entry. Inherited JavaScript object names such as `constructor` must not be considered stored service configuration.

## Impact

Higher-level CLI and SDK callers can receive a false successful-removal result and produce unnecessary configuration churn for unconfigured service names. Watchers, dry-run/change reporting, and cleanup workflows can therefore report state changes or rewrite persisted service configuration solely because an input name collides with an inherited object property.
