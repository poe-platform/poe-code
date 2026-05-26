# Providers constructor environment credential is ignored by login

## Summary

The exported `@poe-code/providers` `ProviderRegistry` accepts `envVars` in its constructor and uses those values for `isLoggedIn()` and `resolveCredential()`, but `login()` ignores the same configured environment unless the caller redundantly passes it again through a per-call context. A registry can therefore report that a provider is authenticated and resolve its API key, yet reject a normal login persistence attempt as if no key were available.

## Reproduction

Create the disposable probe `packages/providers/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SecretStore } from "auth-store";
import { ProviderRegistry } from "./registry.js";
import { anthropicProvider } from "./providers/anthropic.js";

describe("ProviderRegistry constructor environment login", () => {
  it("rejects login despite recognizing the same configured environment credential", async () => {
    const store: SecretStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined)
    };
    const registry = new ProviderRegistry([anthropicProvider], () => store, {
      envVars: { ANTHROPIC_API_KEY: "sk-from-constructor-env" }
    });

    const loggedIn = await registry.isLoggedIn("anthropic");
    const resolved = await registry.resolveCredential("anthropic");
    const outcome = await registry.login("anthropic", {}).then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error))
    );
    console.log(JSON.stringify({ loggedIn, resolved, outcome }));

    expect(loggedIn).toBe(true);
    expect(resolved).toBe("sk-from-constructor-env");
    expect(outcome).toContain("No API key available");
    expect(store.set).not.toHaveBeenCalled();
  });
});
```

Run the targeted test, then delete the probe:

```sh
npm exec -- vitest run packages/providers/src/__probe__.test.ts --reporter verbose
rm -f packages/providers/src/__probe__.test.ts
```

The probe passes and prints that status and resolution accept the constructor environment while login rejects it:

```text
{"loggedIn":true,"resolved":"sk-from-constructor-env","outcome":"No API key available for provider \"anthropic\". Pass --api-key or run interactively."}
✓ packages/providers/src/__probe__.test.ts > ProviderRegistry constructor environment login > rejects login despite recognizing the same configured environment credential
```

## Observed Behavior

`ProviderRegistry` is exported from `packages/providers/src/index.ts:12`, and its constructor retains `options.envVars` in `packages/providers/src/registry.ts:35` through `packages/providers/src/registry.ts:50`. `isLoggedIn()` reads `this.envVars` at lines 67 through 77, while `resolveCredential()` falls back to `this.envVars` at lines 107 through 128. By contrast, `login()` reads only `context?.envVars` at lines 80 through 104; without a redundant per-call context, it passes `undefined` into `apiKeyAuthStrategy.login()`, which rejects absent input at `packages/providers/src/auth/api-key.ts:17` through `packages/providers/src/auth/api-key.ts:38`. The same registry instance therefore returns authenticated/resolvable status for `ANTHROPIC_API_KEY` while refusing to save that available credential.

## Expected Behavior

`ProviderRegistry.login()` should use the registry's configured environment values under the same precedence rules as `resolveCredential()`, unless an explicit per-call environment override is provided. A non-empty credential that the registry recognizes as active should be usable for its login/persistence operation without requiring callers to supply the identical environment map twice.

## Impact

SDK integrations that construct a registry with environment-backed credentials can successfully authenticate requests and display logged-in provider state, but fail when attempting to persist or normalize that active credential through `login()`. Callers may need unnecessary prompts or duplicated environment plumbing, and non-interactive automation can fail despite having a valid credential already configured on the registry.
