# Providers blank stored credential reports logged in but cannot resolve

## Summary

`@poe-code/providers` reports an API-key provider as logged in whenever its secret store returns any non-null string, including whitespace-only content. The same registry then rejects that stored value when asked to resolve a credential, so status output can say a provider is authenticated while all credential-dependent actions fail immediately.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > packages/providers/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "./registry.js";
import { anthropicProvider } from "./providers/anthropic.js";

describe("ProviderRegistry stored blank credential status", () => {
  it("reports logged in while credential resolution rejects the stored value", async () => {
    const store = {
      get: async () => "   \n\t",
      set: async () => undefined,
      delete: async () => undefined
    };
    const registry = new ProviderRegistry([anthropicProvider], () => store);

    const loggedIn = await registry.isLoggedIn("anthropic");
    let resolveError = "";
    try {
      await registry.resolveCredential("anthropic");
    } catch (error) {
      resolveError = error instanceof Error ? error.message : String(error);
    }

    console.log(JSON.stringify({ loggedIn, resolveError }));
    expect(loggedIn).toBe(true);
    expect(resolveError).toContain("No stored credential");
  });
});
PROBE
npm exec -- vitest run packages/providers/src/__probe__.test.ts --reporter verbose
rm packages/providers/src/__probe__.test.ts
```

Output:

```text
{"loggedIn":true,"resolveError":"No stored credential for provider \"anthropic\". Run `poe-code provider login anthropic`."}
✓ packages/providers/src/__probe__.test.ts > ProviderRegistry stored blank credential status > reports logged in while credential resolution rejects the stored value
```

## Observed Behavior

`ProviderRegistry.isLoggedIn()` in `packages/providers/src/registry.ts:67` through `packages/providers/src/registry.ts:77` validates environment values with `trim()` but treats a stored credential as authenticated solely when it is not `null`. For a whitespace-only stored value it therefore returns `true`. Later, `ProviderRegistry.resolveCredential()` delegates stored-value validation to `apiKeyAuthStrategy.resolveCredential()`, which rejects empty or whitespace-only values at `packages/providers/src/auth/api-key.ts:50` through `packages/providers/src/auth/api-key.ts:58`. The reproduction demonstrates both results from the same registry and same store content.

## Expected Behavior

Provider login status and credential resolution should agree on whether a stored secret is usable. A whitespace-only stored API key should be reported as not logged in, matching the existing validation used for environment credentials and stored credential resolution.

## Impact

Corrupt, partially migrated, or externally edited credential stores can cause provider status commands and interactive selection flows to advertise a usable login that fails as soon as the provider is used. Users may repeatedly choose a provider marked logged in, receive confusing missing-credential failures, and misdiagnose the problem as an agent or network issue rather than invalid persisted authentication state.
