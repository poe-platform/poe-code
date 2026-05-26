# E2E test runner cached stored API key survives credential removal

## Summary

The exported `@poe-code/e2e-test-runner` credential helper caches a Poe API key loaded from the configured secret store in module state. After another workflow removes or rotates that stored credential, subsequent `getApiKey()` calls in the same process return the stale previously cached secret without re-reading storage.

## Reproduction

From the repository root, create and run this disposable probe, then remove it:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn<() => Promise<string | null>>();
vi.mock('auth-store', () => ({
  createSecretStore: () => ({ store: { get } }),
}));

describe('cached API key after store removal', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.POE_API_KEY;
    get.mockReset();
  });

  it('reuses an earlier stored credential after it has been removed', async () => {
    get.mockResolvedValueOnce('sk-first').mockResolvedValueOnce(null);
    const credentials = await import('./credentials.js');

    await expect(credentials.getApiKey()).resolves.toBe('sk-first');
    await expect(credentials.getApiKey()).resolves.toBe('sk-first');
    expect(get).toHaveBeenCalledTimes(1);
  });
});
```

```sh
cat > packages/e2e-test-runner/src/__probe__.test.ts <<'EOF'
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn<() => Promise<string | null>>();
vi.mock('auth-store', () => ({
  createSecretStore: () => ({ store: { get } }),
}));

describe('cached API key after store removal', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.POE_API_KEY;
    get.mockReset();
  });

  it('reuses an earlier stored credential after it has been removed', async () => {
    get.mockResolvedValueOnce('sk-first').mockResolvedValueOnce(null);
    const credentials = await import('./credentials.js');

    await expect(credentials.getApiKey()).resolves.toBe('sk-first');
    await expect(credentials.getApiKey()).resolves.toBe('sk-first');
    expect(get).toHaveBeenCalledTimes(1);
  });
});
EOF
npm exec -- vitest run packages/e2e-test-runner/src/__probe__.test.ts --reporter verbose
rm packages/e2e-test-runner/src/__probe__.test.ts
```

The probe passes while proving the secret store is never consulted after the initial read:

```text
✓ packages/e2e-test-runner/src/__probe__.test.ts > cached API key after store removal > reuses an earlier stored credential after it has been removed
```

## Observed Behavior

`packages/e2e-test-runner/src/index.ts:10` publicly exports `getApiKey()`. The module initializes `cachedApiKey` state at `packages/e2e-test-runner/src/credentials.ts:3`, writes it from either environment or secret-store credentials at `packages/e2e-test-runner/src/credentials.ts:13` through `packages/e2e-test-runner/src/credentials.ts:37`, and returns it immediately on all later calls at `packages/e2e-test-runner/src/credentials.ts:20` through `packages/e2e-test-runner/src/credentials.ts:22`. In the reproduction, the mocked store would return `null` after the first successful key read, representing credential deletion, but `getApiKey()` returns `"sk-first"` again and `store.get()` is called only once.

## Expected Behavior

A credential removed or rotated in the configured persistent store should not remain usable indefinitely through an already-running E2E helper process. The helper should reload stored credentials when authorization is needed or expose an explicit invalidation path that logout/rotation workflows can reliably trigger.

## Impact

Logout, key revocation, and credential-rotation tests can continue creating authenticated E2E containers with a secret that persistent state no longer authorizes. Long-lived test processes may transmit obsolete or intentionally removed Poe keys, undermining cleanup expectations and making authentication behavior depend on whether a prior test happened to warm an in-memory cache.
