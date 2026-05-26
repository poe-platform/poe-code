# Providers stored credential preserves padding that other sources trim

## Summary

`@poe-code/providers` normalizes explicit and environment-provided API keys by trimming surrounding whitespace before returning them, but returns a nonblank credential loaded from the secret store unchanged. The same logical API key therefore produces different authentication material depending only on whether it is passed directly, supplied through the environment, or loaded from persistent storage.

## Reproduction

Create the disposable probe `packages/providers/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ProviderRegistry } from './registry.js';
import { anthropicProvider } from './providers/anthropic.js';

describe('ProviderRegistry stored credential normalization', () => {
  it('returns whitespace from stored credentials that explicit and env inputs trim away', async () => {
    const paddedKey = '  sk-shared  ';
    const store = {
      get: async () => paddedKey,
      set: async () => undefined,
      delete: async () => undefined,
    };
    const storedRegistry = new ProviderRegistry([anthropicProvider], () => store);
    const envRegistry = new ProviderRegistry([anthropicProvider], () => store, {
      envVars: { ANTHROPIC_API_KEY: paddedKey },
    });

    await expect(storedRegistry.resolveCredential('anthropic', { apiKey: paddedKey })).resolves.toBe('sk-shared');
    await expect(envRegistry.resolveCredential('anthropic')).resolves.toBe('sk-shared');
    await expect(storedRegistry.resolveCredential('anthropic')).resolves.toBe(paddedKey);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/providers/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/providers/src/__probe__.test.ts > ProviderRegistry stored credential normalization > returns whitespace from stored credentials that explicit and env inputs trim away
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`ProviderRegistry.resolveCredential()` normalizes explicitly supplied credentials through `normalizeRequiredCredential()` at `packages/providers/src/registry.ts:117` through `packages/providers/src/registry.ts:119`, and trims configured environment credentials before returning them at lines 121 through 125. Stored values are delegated to `apiKeyAuthStrategy.resolveCredential()` at lines 127 through 128. That resolver verifies `value.trim().length > 0` but returns the original untrimmed `value` at `packages/providers/src/auth/api-key.ts:50` through `packages/providers/src/auth/api-key.ts:59`. In the probe, both transient input paths return `"sk-shared"`, while the stored path returns `"  sk-shared  "`.

## Expected Behavior

Credential resolution should return a canonical API-key value regardless of its source. If surrounding whitespace is considered user-entry padding and removed for explicit or environment credentials, the same normalization must be applied when returning a persisted credential.

## Impact

A credential entered or migrated with accidental leading or trailing whitespace can work during the initial configure/login invocation but fail later after it is read from storage and transmitted with the padding intact. Users can see source-dependent authentication behavior for the same visible key, making persisted logins unreliable and difficult to diagnose.
