# E2E Graceful Skip on Missing API Key — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Make e2e tests exit cleanly (code 0) when `POE_API_KEY` is unavailable, so CI doesn't show a false failure on fork PRs.

**Architecture:** The e2e global setup (`e2e/setup.ts`) currently throws when any preflight check fails, crashing vitest with exit code 1. We split preflight failures into "hard" (Docker missing/not running — test infra is broken) and "soft" (API key missing — external dependency unavailable). On soft-only failures, log a skip message and exit cleanly via `process.exit(0)`. Hard failures still throw.

**Tech Stack:** TypeScript, vitest globalSetup, `@poe-code/e2e-docker-test-runner`

---

### Task 1: Add `critical` flag to preflight CheckResult

**Files:**
- Modify: `packages/e2e-docker-test-runner/src/preflight.ts`
- Test: `packages/e2e-docker-test-runner/src/preflight.test.ts`

**Step 1: Write the failing test**

Add a new describe block to `preflight.test.ts` that verifies the API key check result includes `critical: false`:

```typescript
describe('runPreflight - soft failure on missing API key', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  async function setup() {
    const { execSync } = await import('node:child_process');
    const { detectEngine } = await import('./engine.js');
    const { detectRunningContext } = await import('./context.js');
    const { hasApiKey } = await import('./credentials.js');
    const { runPreflight } = await import('./preflight.js');

    vi.mocked(detectEngine).mockReturnValue('docker');
    vi.mocked(detectRunningContext).mockReturnValue(null);

    vi.mocked(execSync).mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('docker info')) return Buffer.from('ok');
      if (cmdStr.includes('ps -aq')) return Buffer.from('');
      if (cmdStr.includes('images --format')) return Buffer.from('');
      return Buffer.from('');
    });

    return { hasApiKey: vi.mocked(hasApiKey), runPreflight };
  }

  it('marks API key failure as non-critical', async () => {
    const { hasApiKey, runPreflight } = await setup();
    hasApiKey.mockResolvedValue(false);

    const { passed, results } = await runPreflight();

    expect(passed).toBe(false);
    const apiKeyResult = results.find(r => r.name === 'API key available');
    expect(apiKeyResult).toBeDefined();
    expect(apiKeyResult!.passed).toBe(false);
    expect(apiKeyResult!.critical).toBe(false);
  });

  it('marks Docker checks as critical', async () => {
    const { hasApiKey, runPreflight } = await setup();
    hasApiKey.mockResolvedValue(true);

    const { results } = await runPreflight();

    const dockerCheck = results.find(r => r.name === 'Docker installed');
    expect(dockerCheck).toBeDefined();
    expect(dockerCheck!.critical).not.toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/e2e-docker-test-runner/src/preflight.test.ts`
Expected: FAIL — `critical` property doesn't exist on CheckResult

**Step 3: Add `critical` flag to CheckResult and preflight checks**

In `packages/e2e-docker-test-runner/src/preflight.ts`:

1. Add `critical?: boolean` to the `CheckResult` interface (default is `true` when omitted)
2. In `checkApiKey()`, add `critical: false` to the failure result

```typescript
interface CheckResult {
  name: string;
  passed: boolean;
  message?: string;
  fix?: string;
  critical?: boolean;  // defaults to true when omitted
}
```

In `checkApiKey()`:
```typescript
return {
  name: 'API key available',
  passed: false,
  critical: false,
  message: 'API key not available',
  fix: '...',
};
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/e2e-docker-test-runner/src/preflight.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/e2e-docker-test-runner/src/preflight.ts packages/e2e-docker-test-runner/src/preflight.test.ts
git commit -m "feat(e2e-docker-test-runner): mark API key preflight check as non-critical"
```

---

### Task 2: Export `CheckResult` type and add `hasCriticalFailure` helper

**Files:**
- Modify: `packages/e2e-docker-test-runner/src/preflight.ts`
- Modify: `packages/e2e-docker-test-runner/src/index.ts`
- Test: `packages/e2e-docker-test-runner/src/preflight.test.ts`

**Step 1: Write the failing test**

Add to the "soft failure on missing API key" describe block in `preflight.test.ts`:

```typescript
it('hasCriticalFailure returns false when only non-critical checks fail', async () => {
  const { hasApiKey, runPreflight } = await setup();
  const { hasCriticalFailure } = await import('./preflight.js');
  hasApiKey.mockResolvedValue(false);

  const { results } = await runPreflight();

  expect(hasCriticalFailure(results)).toBe(false);
});

it('hasCriticalFailure returns true when a critical check fails', async () => {
  const { hasCriticalFailure } = await import('./preflight.js');

  const results = [
    { name: 'Docker installed', passed: false, critical: undefined as boolean | undefined },
  ];
  expect(hasCriticalFailure(results)).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/e2e-docker-test-runner/src/preflight.test.ts`
Expected: FAIL — `hasCriticalFailure` not exported

**Step 3: Implement `hasCriticalFailure`**

Add to `packages/e2e-docker-test-runner/src/preflight.ts`:

```typescript
export function hasCriticalFailure(results: CheckResult[]): boolean {
  return results.some(r => !r.passed && r.critical !== false);
}
```

Export it from `packages/e2e-docker-test-runner/src/index.ts`:

```typescript
export { runPreflight, formatPreflightResults, hasCriticalFailure } from './preflight.js';
export type { CheckResult } from './preflight.js';
```

Also export `CheckResult` from `preflight.ts`:

```typescript
export interface CheckResult {
  // ...
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/e2e-docker-test-runner/src/preflight.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/e2e-docker-test-runner/src/preflight.ts packages/e2e-docker-test-runner/src/preflight.test.ts packages/e2e-docker-test-runner/src/index.ts
git commit -m "feat(e2e-docker-test-runner): add hasCriticalFailure helper"
```

---

### Task 3: Update `e2e/setup.ts` to gracefully skip on soft failures

**Files:**
- Modify: `e2e/setup.ts`

**Step 1: Update setup.ts**

Replace `e2e/setup.ts` with:

```typescript
import { runPreflight, formatPreflightResults, hasCriticalFailure } from '@poe-code/e2e-docker-test-runner';

export async function setup(): Promise<void> {
  const { passed, results } = await runPreflight();
  console.error(formatPreflightResults(results));

  if (!passed) {
    if (hasCriticalFailure(results)) {
      throw new Error('Preflight checks failed');
    }
    console.error('\nSkipping e2e tests: non-critical preflight checks failed.\n');
    process.exit(0);
  }
}
```

When only soft checks (API key) fail: logs the preflight results, prints a skip message, exits cleanly with code 0.
When hard checks (Docker) fail: throws, vitest crashes with code 1 (correct — infra is broken).

**Step 2: Verify locally (manual)**

Run: `POE_API_KEY= npm run e2e:verbose`
Expected: Preflight output shows ✗ API key, then "Skipping e2e tests", exits 0.

Run: `npm run e2e:verbose` (with valid API key)
Expected: All e2e tests run normally.

**Step 3: Commit**

```bash
git add e2e/setup.ts
git commit -m "fix(e2e): gracefully skip tests when API key is unavailable"
```

---

### Task 4: Run full test suite

**Step 1: Run unit tests**

Run: `npm run test`
Expected: All tests pass

**Step 2: Run lint**

Run: `npm run lint`
Expected: Clean

**Step 3: Run e2e tests**

Run: `npm run e2e:verbose`
Expected: All 20 tests pass
