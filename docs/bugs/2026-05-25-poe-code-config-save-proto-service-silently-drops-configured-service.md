# Poe code config save proto service silently drops configured service

## Summary

The exported `@poe-code/poe-code-config` `saveConfiguredService()` API cannot persist a configured service named `"__proto__"`. It accepts the service entry and resolves successfully, but bracket assignment mutates the temporary service-map prototype rather than creating an own entry, so no configured service is written or returned on reload.

## Reproduction

Add the following disposable test as `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { createMockFs } from "@poe-code/config-mutations/testing";
import { describe, expect, it } from "vitest";
import { loadConfiguredServices, saveConfiguredService } from "./configured-services.js";

describe("configured service special save name", () => {
  it("does not persist a service named __proto__", async () => {
    const fs = createMockFs(undefined, "/home/test");

    await saveConfiguredService({
      fs,
      filePath: "/home/test/.poe-code/config.json",
      service: "__proto__",
      metadata: { provider: "poe", apiShape: "openai-responses", files: [] }
    });

    await expect(
      loadConfiguredServices({ fs, filePath: "/home/test/.poe-code/config.json" })
    ).resolves.toEqual({});
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
✓ packages/poe-code-config/src/__probe__.test.ts > configured service special save name > does not persist a service named __proto__
```

Remove the disposable probe after confirmation.

## Observed Behavior

`saveConfiguredService()` creates a normal object for normalized configured services and assigns the supplied key with `services[service] = ...`. When `service` is `"__proto__"`, assignment changes the object's prototype instead of creating an enumerable configured-service entry. `writeScope()` sees no own values in the service map and writes no `configured_services` scope, while a subsequent `loadConfiguredServices()` returns an empty object.

## Expected Behavior

Saving a service name accepted by the public API should either persist and round-trip that exact service entry or reject the name explicitly. A schema-valid string name such as `"__proto__"` must not be silently acknowledged and discarded due to JavaScript object prototype semantics.

## Impact

Configuration commands or SDK integrations that receive service identifiers dynamically can report success while losing the requested configuration. The stored state and runtime service selection then disagree with the requested operation, and callers have no error signal indicating that the persisted service entry was dropped.
