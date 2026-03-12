# E2E Graceful Skip on Missing API Key — EARS-Improved Plan

> **Original plan:** `docs/plans/2026-03-12-e2e-graceful-skip.md`
> **Improved with:** EARS requirements syntax, adversarial review fixes
> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Make e2e tests exit cleanly (code 0) when `POE_API_KEY` is unavailable, so CI doesn't show a false failure on fork PRs.

**Architecture:** The e2e global setup (`e2e/setup.ts`) currently throws when any preflight check fails, crashing vitest with exit code 1. We split preflight failures into "critical" (Docker missing/not running — test infra is broken) and "non-critical" (API key missing — external dependency unavailable). On non-critical-only failures, log a skip message and call `process.exit(0)`. Critical failures still throw. The `runPreflight` function is also changed to no longer early-return on API key failure, so Docker cleanup/prune steps still execute even when the API key is missing.

**System(s) under change:** `@poe-code/e2e-docker-test-runner` (preflight module), `e2e/setup.ts` (vitest globalSetup)

---

## Requirements

R1: **Where** `CheckResult` is defined, **the system shall** include an optional `critical?: boolean` field. When omitted, the check is treated as critical (defaults to `true`).

R2: **When** the API key preflight check fails, **the system shall** return a `CheckResult` with `critical: false`.

R3: **Where** `hasCriticalFailure(results)` is called with an array of `CheckResult`, **the system shall** return `true` if any result has `passed === false` AND `critical !== false`.

R4: **When** `hasCriticalFailure` is called with an empty array, **the system shall** return `false`.

R5: **When** all preflight checks pass, `setup()` **shall** return normally (no throw, no exit).

R6: **When** any critical check fails, `setup()` **shall** throw an `Error`.

R7: **When** only non-critical checks fail, `setup()` **shall** log a skip message to stderr and call `process.exit(0)`.

R8: **When** preflight checks complete, `setup()` **shall** always log formatted preflight results to stderr before any exit/throw decision.

R9: **When** the API key check fails, `runPreflight` **shall** continue executing subsequent steps (cleanup orphans, prune old images) instead of returning early. These steps are Docker-only operations with no API key dependency.

---

## Implementation

### Task 1: Add `critical` flag and mark API key as non-critical; remove early return

S1 (R1, R2, R9): Write failing tests in `packages/e2e-docker-test-runner/src/preflight.test.ts`:
  - "marks API key failure as non-critical" — asserts `critical: false`, `passed: false`
  - "marks Docker checks as critical" — asserts Docker result `critical !== false`
  - "continues to cleanup and prune even when API key is missing" — asserts `ps -aq` called

S2 (R1, R2, R9): Implement in `packages/e2e-docker-test-runner/src/preflight.ts`:
  - Add `critical?: boolean` to `CheckResult` interface (with JSDoc)
  - Export `CheckResult`
  - Add `critical: false` to `checkApiKey()` failure return
  - Remove early-return on API key failure (lines 40-42)
  - Compute `passed` at end: `const passed = results.every(r => r.passed)`
  - Docker early-returns (lines 24-26, 33-35) remain — without Docker, nothing else can run

CHECKPOINT: `npx vitest run packages/e2e-docker-test-runner/src/preflight.test.ts` — all pass

### Task 2: Export `hasCriticalFailure` helper

S3 (R3, R4): Write failing tests in `packages/e2e-docker-test-runner/src/preflight.test.ts`:
  - "hasCriticalFailure returns false when only non-critical checks fail"
  - "hasCriticalFailure returns true when a critical check fails" (undefined counts as critical)
  - "hasCriticalFailure returns false for empty array"

S4 (R3, R4): Implement in `packages/e2e-docker-test-runner/src/preflight.ts`:
  - Add: `export function hasCriticalFailure(results: CheckResult[]): boolean { return results.some(r => !r.passed && r.critical !== false); }`

S5: Export from `packages/e2e-docker-test-runner/src/index.ts`:
  - Add `hasCriticalFailure` to preflight re-export
  - Add `export type { CheckResult }` re-export

CHECKPOINT: `npx vitest run packages/e2e-docker-test-runner/src/preflight.test.ts` — all pass

### Task 3: Update `e2e/setup.ts` to gracefully skip on soft failures

**IMPORTANT:** Must land after Tasks 1-2. Without Tasks 1-2, this change would not compile.

S6 (R5, R6, R7, R8): Replace `e2e/setup.ts` with:
  - Files: `e2e/setup.ts`
  - Action:
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
  - CRITICAL: The non-critical path must call `process.exit(0)`, NOT just return. A bare return would let vitest proceed to run tests that would all fail without an API key.

CHECKPOINT: `npm run test && npm run lint && npm run e2e:verbose` — all pass

---

## Verification

V1 (R1, R2): Unit test "marks API key failure as non-critical" — `critical === false`, `passed === false`.
  Expected: PASS

V2 (R1): Unit test "marks Docker checks as critical" — Docker result `critical !== false`.
  Expected: PASS

V3 (R3): Unit test "hasCriticalFailure returns true when a critical check fails" — `undefined` treated as critical.
  Expected: PASS

V4 (R3): Unit test "hasCriticalFailure returns false when only non-critical checks fail".
  Expected: PASS

V5 (R4): Unit test "hasCriticalFailure returns false for empty array".
  Expected: PASS

V6 (R9): Unit test "continues to cleanup and prune even when API key is missing" — `ps -aq` called.
  Expected: PASS

V7 (R5): `npm run e2e:verbose` with valid API key — all tests run normally.
  Expected: 20+ tests pass

V8 (R7, R8): `POE_API_KEY= npm run e2e:verbose` — logs preflight results, logs skip message, exits 0.
  Expected: Exit code 0, stderr contains "Skipping e2e tests"

---

## Traceability Matrix

| Req | Implementation Steps | Verification |
|-----|---------------------|-------------|
| R1  | S2, S4              | V1, V2      |
| R2  | S2                  | V1          |
| R3  | S4                  | V3, V4      |
| R4  | S4                  | V5          |
| R5  | S6                  | V7          |
| R6  | S6                  | V8          |
| R7  | S6                  | V8          |
| R8  | S6                  | V7, V8      |
| R9  | S2                  | V6          |

---

## Known Gaps / Future Work

- **No unit test for `setup.ts`:** Thin integration shim tested via manual e2e runs. Unit testing would require mocking `process.exit` and the entire `@poe-code/e2e-docker-test-runner` module — counter to YAGNI.
- **Future non-critical checks:** If additional optional checks are added (e.g., network connectivity), the same `critical: false` pattern applies with no changes to `hasCriticalFailure` or `setup.ts`.
