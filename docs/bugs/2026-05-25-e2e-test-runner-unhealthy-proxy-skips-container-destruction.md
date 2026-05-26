# E2E test runner unhealthy proxy skips container destruction

## Summary

`useContainer()` validates proxy health before it destroys the active E2E container in its registered `afterEach` hook. If the proxy health assertion rejects, teardown exits immediately and never invokes `destroy()`, leaving the failed test container and its resources behind precisely when diagnostics report that the proxy is unhealthy.

## Reproduction

Create the disposable probe `packages/e2e-test-runner/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Container } from './types.js';

vi.mock('./backend.js', () => ({
  resolveBackend: vi.fn(() => 'sandbox'),
  createBackendContainer: vi.fn(),
}));
vi.mock('./runtime.js', () => ({ setWorkspaceDir: vi.fn() }));

describe('useContainer failed proxy health teardown', () => {
  it('skips destroy when the proxy health check rejects', async () => {
    let setup: (() => Promise<void>) | undefined;
    let teardown: (() => Promise<void>) | undefined;
    const healthFailure = new Error('proxy became unhealthy');

    vi.doMock('vitest', () => ({
      beforeEach: (callback: () => Promise<void>) => {
        setup = callback;
      },
      afterEach: (callback: () => Promise<void>) => {
        teardown = callback;
      },
      expect: () => ({
        toHaveHealthyProxy: vi.fn().mockRejectedValue(healthFailure),
      }),
    }));

    const container = {
      destroy: vi.fn().mockResolvedValue(undefined),
      login: vi.fn().mockResolvedValue(undefined),
    } as unknown as Container;
    const { createBackendContainer } = await import('./backend.js');
    vi.mocked(createBackendContainer).mockResolvedValue(container);
    const { useContainer } = await import('./use-container.js');

    useContainer({ testName: 'failed-health' });

    await setup?.();
    await expect(teardown?.()).rejects.toBe(healthFailure);
    expect(container.destroy).not.toHaveBeenCalled();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/e2e-test-runner/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/e2e-test-runner/src/__probe__.test.ts > useContainer failed proxy health teardown > skips destroy when the proxy health check rejects
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

The `afterEach` callback registered at `packages/e2e-test-runner/src/use-container.ts:24` checks `await expect(current).toHaveHealthyProxy()` at line 26 and reaches `await current.destroy()` only at line 27. In the probe, the registered health check rejects with `proxy became unhealthy`, the teardown callback propagates that failure, and the container `destroy()` spy is never called.

## Expected Behavior

Container destruction should run even when the proxy health assertion fails, while preserving the proxy-health failure for the test result. A diagnostic assertion during teardown must not suppress mandatory resource cleanup.

## Impact

Any E2E test whose proxy log contains errors or lacks its expected listening confirmation can leak its sandbox, environment, proxy server, temporary data, or allocated ports. The leak occurs on the failure path where cleanup matters most, contaminating later tests and making local or CI resource exhaustion increasingly likely.
