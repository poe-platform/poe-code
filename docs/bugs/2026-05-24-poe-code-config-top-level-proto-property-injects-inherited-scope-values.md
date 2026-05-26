# Poe-code config top-level proto property injects inherited scope values

## Summary

`@poe-code/poe-code-config` normalizes parsed configuration documents into ordinary objects by assigning every top-level scope name. A JSON top-level property named `__proto__` changes the normalized document prototype instead of remaining an inert configuration key, allowing inherited scope values to be returned as if they had been stored in the configuration.

## Reproduction

From the repository root, run this disposable Vitest probe, which reads an in-memory configuration document containing only a `__proto__` key and then resolves an otherwise absent `feature` scope:

```sh
cat > packages/poe-code-config/src/__probe__.test.ts <<'TEST'
import { createMockFs } from "@poe-code/config-mutations/testing";
import { describe, expect, it } from "vitest";
import { createConfigStore } from "./config.js";
import { defineScope } from "./schema.js";

describe("poe-code-config top-level __proto__", () => {
  it("resolves a scope injected through a parsed __proto__ top-level key", async () => {
    const homeDir = "/home/test";
    const configPath = `${homeDir}/.poe-code/config.json`;
    const fs = createMockFs(
      {
        "~/.poe-code/config.json": '{"__proto__":{"feature":{"mode":"attacker"}}}\n'
      },
      homeDir
    );
    const featureScope = defineScope("feature", {
      mode: {
        type: "string" as const,
        default: "safe",
        doc: "Feature mode"
      }
    });
    const feature = createConfigStore({ fs, filePath: configPath }).scope(featureScope);

    const values = await feature.getAll();
    console.log(JSON.stringify({ values, injected: values.mode === "attacker" }));

    expect(values.mode).toBe("attacker");
  });
});
TEST
npx vitest run packages/poe-code-config/src/__probe__.test.ts --reporter=verbose
rm packages/poe-code-config/src/__probe__.test.ts
```

The probe passes and prints:

```text
{"values":{"mode":"attacker"},"injected":true}
✓ packages/poe-code-config/src/__probe__.test.ts > poe-code-config top-level __proto__ > resolves a scope injected through a parsed __proto__ top-level key
```

## Observed Behavior

`packages/poe-code-config/src/store.ts:102` constructs the normalized document as `{}` and assigns parsed top-level keys with `document[scope] = normalizedValues` at `packages/poe-code-config/src/store.ts:111`. When `scope` is `__proto__`, the assignment replaces the normalized document prototype with an object containing `feature.mode`. `packages/poe-code-config/src/config.ts:40` then reads `document[definition.scope]`, and `packages/poe-code-config/src/resolve.ts:16` through `packages/poe-code-config/src/resolve.ts:20` resolves `mode` from that inherited injected scope.

## Expected Behavior

Configuration parsing should preserve accepted JSON keys as own data properties or reject dangerous keys. A top-level `__proto__` property must not modify the normalized document prototype or cause absent scopes to resolve attacker-controlled settings.

## Impact

A crafted configuration file can smuggle settings into arbitrary configured scopes through inheritance rather than explicit persisted configuration. Any CLI or SDK behavior that reads affected scopes may act on injected values while inspections of own configuration entries do not show the source scope.
