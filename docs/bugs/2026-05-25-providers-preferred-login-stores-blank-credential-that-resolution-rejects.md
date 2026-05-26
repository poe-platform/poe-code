# Providers preferred login stores blank credential that resolution rejects

## Summary

`@poe-code/providers` bypasses API-key validation when a provider uses its preferred login resolver. For the Poe OAuth path, `ProviderRegistry.login()` persists whatever `resolvePreferredLogin()` returns, including a whitespace-only credential that the same registry later rejects as unavailable.

## Reproduction

1. From the repository root, create this disposable Vitest probe:

   ```sh
   cat > packages/providers/src/__probe__.test.ts <<'EOF'
   import { describe, expect, it } from "vitest";
   import { poeProvider, ProviderRegistry } from "./index.js";

   describe("ProviderRegistry preferred login validation", () => {
     it("stores a blank preferred-login credential that later cannot be resolved", async () => {
       let stored: string | null = null;
       const store = {
         get: async () => stored,
         set: async (value: string) => { stored = value; },
         delete: async () => { stored = null; }
       };
       const registry = new ProviderRegistry([poeProvider], () => store);

       await registry.login("poe", {}, {
         resolvePreferredLogin: async () => "   "
       });

       expect(stored).toBe("   ");
       await expect(registry.resolveCredential("poe")).rejects.toThrow(
         'No stored credential for provider "poe".'
       );
     });
   });
   EOF
   ```

2. Run the probe and remove it afterward:

   ```sh
   npm exec -- vitest run packages/providers/src/__probe__.test.ts --reporter verbose
   rm -f packages/providers/src/__probe__.test.ts
   ```

3. The disposable probe passes:

   ```text
   ✓ packages/providers/src/__probe__.test.ts > ProviderRegistry preferred login validation > stores a blank preferred-login credential that later cannot be resolved

   Test Files  1 passed (1)
        Tests  1 passed (1)
   ```

## Observed Behavior

`ProviderRegistry.login("poe", ...)` resolves successfully and writes the whitespace-only value returned by `resolvePreferredLogin()`. In `packages/providers/src/registry.ts:91` through `packages/providers/src/registry.ts:99`, the preferred-login branch writes the resolver output directly to the secret store. It bypasses the normal API-key acquisition validation at `packages/providers/src/auth/api-key.ts:19` through `packages/providers/src/auth/api-key.ts:29`. A subsequent credential resolution rejects that stored value as missing.

## Expected Behavior

Preferred login results should be validated under the same non-empty credential invariant as explicit input, environment credentials, prompts, and stored credential resolution. A whitespace-only OAuth/login result should reject without persisting unusable authentication state.

## Impact

An OAuth or other preferred-login integration that returns an empty or malformed key can report successful login while installing a credential that immediately breaks all authenticated provider usage. Users then see a completed authentication flow followed by missing-credential failures until the invalid stored value is replaced.
