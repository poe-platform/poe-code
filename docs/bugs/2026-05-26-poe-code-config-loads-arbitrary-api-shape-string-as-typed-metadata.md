# Poe Code Config loads arbitrary API shape string as typed configured service metadata

## Summary

The exported `@poe-code/poe-code-config` `loadConfiguredServices()` API returns any persisted string in a configured service's `apiShape` field as if it were a valid `ApiShapeId`. A configuration containing `apiShape: "not-a-real-api-shape"` loads successfully and exposes that impossible value through a result typed as supporting only known provider API shapes.

## Reproduction

Create the following disposable probe at `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { loadConfiguredServices } from "./configured-services.js";

describe("configured service api shape validation", () => {
  it("returns an arbitrary persisted apiShape as a typed API shape", async () => {
    const fs = createMockFs({
      "~/.poe-code/config.json": JSON.stringify({
        configured_services: {
          codex: {
            provider: "poe",
            apiShape: "not-a-real-api-shape",
            files: []
          }
        }
      })
    }, "/home/test");

    const services = await loadConfiguredServices({
      fs,
      filePath: "/home/test/.poe-code/config.json"
    });

    expect(services.codex?.apiShape).toBe("not-a-real-api-shape");
  });
});
```

Run the probe and remove it immediately afterward:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-code-config/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/poe-code-config/src/__probe__.test.ts > configured service api shape validation > returns an arbitrary persisted apiShape as a typed API shape
```

## Observed Behavior

`loadConfiguredServices()` resolves successfully and returns `services.codex.apiShape === "not-a-real-api-shape"`, despite its return type promising `ConfiguredServiceMetadata`, whose `apiShape` member is `ApiShapeId | undefined`. In `packages/poe-code-config/src/configured-services.ts:124`, existing string-valued shapes are excluded from derivation or repair solely because they are strings. Then `normalizeConfiguredServices()` casts any string directly to `ApiShapeId` at `packages/poe-code-config/src/configured-services.ts:178` through `packages/poe-code-config/src/configured-services.ts:182`, without checking membership in the supported shape set.

## Expected Behavior

Persisted configured-service metadata should be validated when loaded. An unknown `apiShape` string should be rejected as invalid configuration or repaired by deriving the valid API shape for the known service/provider pair; it must not be returned as a valid typed shape identifier.

## Impact

Consumers of the public configuration API can receive invalid runtime data under a trusted union type and branch or index configuration tables as if the shape were supported. Corrupted or manually edited configuration is silently accepted instead of diagnosed or repaired, making later configuration, reconfiguration, and SDK callers vulnerable to confusing missing-base-URL behavior or undefined shape-specific handling far from the bad persisted field.
