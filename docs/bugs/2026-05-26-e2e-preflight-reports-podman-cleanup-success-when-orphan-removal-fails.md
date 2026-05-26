# E2E preflight reports Podman cleanup success when orphan removal fails

## Summary

`@poe-code/e2e-test-runner` reports that Podman orphan cleanup succeeded after merely discovering labeled containers, even when every `podman stop` and `podman rm -f` operation fails. `cleanupOrphans()` suppresses per-container cleanup errors and returns the number of discovered IDs, which `runPreflight()` presents as successfully cleaned containers while still returning `passed: true`.

## Reproduction

From the repository root, create and run this disposable Vitest probe, then delete it:

```sh
cat > packages/e2e-test-runner/src/__probe__.test.ts <<'EOF'
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execSyncMock = vi.hoisted(() => vi.fn());
const hasApiKeyMock = vi.hoisted(() => vi.fn(async () => true));
const detectEngineMock = vi.hoisted(() => vi.fn(() => 'podman'));

vi.mock('node:child_process', () => ({ execSync: execSyncMock }));
vi.mock('./credentials.js', () => ({ hasApiKey: hasApiKeyMock }));
vi.mock('./engine.js', () => ({ detectEngine: detectEngineMock }));

describe('podman preflight cleanup repro', () => {
  beforeEach(() => {
    vi.resetModules();
    execSyncMock.mockReset();
    execSyncMock.mockImplementation((command: string) => {
      if (command === 'podman info') return '';
      if (command === 'podman ps -aq --filter label=poe-e2e-test-runner=true') return 'orphan\n';
      if (command === 'podman stop orphan' || command === 'podman rm -f orphan') {
        throw new Error('podman refused cleanup');
      }
      return '';
    });
  });

  it('reports cleanup passed even when stopping and removing the orphan both fail', async () => {
    const { runPreflight } = await import('./preflight.js');

    const result = await runPreflight({ backend: 'podman' });

    expect(result.passed).toBe(true);
    expect(result.results).toContainEqual({
      name: 'Cleanup',
      passed: true,
      message: 'Cleaned up 1 orphaned container(s)',
    });
    expect(execSyncMock).toHaveBeenCalledWith('podman stop orphan', { stdio: 'ignore' });
    expect(execSyncMock).toHaveBeenCalledWith('podman rm -f orphan', { stdio: 'ignore' });
  });
});
EOF
npm exec -- vitest run packages/e2e-test-runner/src/__probe__.test.ts --reporter verbose
rm packages/e2e-test-runner/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/e2e-test-runner/src/__probe__.test.ts > podman preflight cleanup repro > reports cleanup passed even when stopping and removing the orphan both fail
```

## Observed Behavior

`cleanupOrphans()` lists the labeled container ID, catches and discards failures from both `podman stop orphan` and `podman rm -f orphan`, then returns `1` at `packages/e2e-test-runner/src/preflight.ts:278`. `runPreflight()` interprets any positive return value as completed cleanup and emits `{ name: 'Cleanup', passed: true, message: 'Cleaned up 1 orphaned container(s)' }` at `packages/e2e-test-runner/src/preflight.ts:89`, while the orphan still exists because neither cleanup command succeeded.

## Expected Behavior

Preflight cleanup should count only containers actually removed, or fail/report a cleanup warning when stop/removal cannot complete. It must not claim a labeled orphan was cleaned solely because it was found.

## Impact

Users and CI can receive a passing environment preflight with a positive cleanup confirmation while stale test containers remain on disk and continue consuming resources. Subsequent E2E runs may encounter retained containers, ports, snapshots, or confusing environment state while diagnostics falsely assert the cleanup already succeeded.
