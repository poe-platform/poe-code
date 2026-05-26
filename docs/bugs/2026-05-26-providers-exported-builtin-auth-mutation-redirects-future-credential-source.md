# Providers exported built-in auth mutation redirects future credential source

## Summary

The public `@poe-code/providers` `anthropicProvider` export contains a live mutable authentication definition that is reused by `ProviderRegistry`. Mutating `anthropicProvider.auth.envVar` makes a later registry resolve the Anthropic credential from a different environment variable than `ANTHROPIC_API_KEY`.

## Reproduction

Create a disposable probe at `packages/providers/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { anthropicProvider, ProviderRegistry } from "./index.js";
import type { SecretStore } from "auth-store";

describe("public built-in provider mutation probe", () => {
  it("redirects future credential resolution to a different environment variable", async () => {
    const auth = anthropicProvider.auth;
    if (auth.kind !== "api-key") {
      throw new Error("probe requires api-key auth");
    }
    const originalEnvVar = auth.envVar;
    auth.envVar = "UNTRUSTED_API_KEY";
    const store: SecretStore = {
      get: async () => "stored-key",
      set: async () => undefined,
      delete: async () => undefined
    };

    try {
      const registry = new ProviderRegistry([anthropicProvider], () => store, {
        envVars: { ANTHROPIC_API_KEY: "intended-key", UNTRUSTED_API_KEY: "redirected-key" }
      });

      await expect(registry.resolveCredential("anthropic")).resolves.toBe("redirected-key");
    } finally {
      auth.envVar = originalEnvVar;
    }
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/providers/src/__probe__.test.ts --reporter verbose
rm -f packages/providers/src/__probe__.test.ts
```

The probe passes, confirming that public provider-definition mutation redirects a subsequent credential lookup:

```text
✓ packages/providers/src/__probe__.test.ts > public built-in provider mutation probe > redirects future credential resolution to a different environment variable
```

## Observed Behavior

`anthropicProvider` is defined as a normal nested object whose API-key authentication declares `envVar: "ANTHROPIC_API_KEY"` at `packages/providers/src/providers/anthropic.ts:3` through `packages/providers/src/providers/anthropic.ts:23`, and it is publicly exported at `packages/providers/src/index.ts:18` through `packages/providers/src/index.ts:23`. `ProviderRegistry` stores the supplied live provider object in its identifier map at `packages/providers/src/registry.ts:35` through `packages/providers/src/registry.ts:50`. Its public `resolveCredential()` method then reads the provider's current `auth.envVar` to select an environment-sourced credential at `packages/providers/src/registry.ts:107` through `packages/providers/src/registry.ts:129`. After an unrelated consumer assigns `anthropicProvider.auth.envVar = "UNTRUSTED_API_KEY"`, a new registry constructed with both `ANTHROPIC_API_KEY="intended-key"` and `UNTRUSTED_API_KEY="redirected-key"` resolves `"redirected-key"` for provider id `"anthropic"`.

## Expected Behavior

Public inspection of built-in provider metadata must not alter authentication input selection for future registry operations. Built-in definitions should be deeply immutable or registries should snapshot validated provider metadata, so Anthropic credential resolution continues to use `ANTHROPIC_API_KEY` unless a supported provider-configuration mechanism explicitly changes that contract.

## Impact

Any same-process extension, test helper, or integration that mutates exported provider metadata can silently change which environment secret is used for subsequent authenticated requests. A valid intended credential can be bypassed in favor of an unrelated value, causing requests to run under the wrong account, fail unexpectedly, or leak trust in attacker-controlled ambient environment configuration.
